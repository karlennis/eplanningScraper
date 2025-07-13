# Planning Document Scraper

A Node.js application for scraping planning documents from the Meath County Council planning portal. The scraper can save documents locally, upload to AWS S3, or both.

## Features

- 🏗️ Scrapes planning documents from Meath County Council portal
- 📁 Flexible storage options: local files, S3 cloud storage, or both
- ☁️ Robust S3 integration with automatic retry and error handling
- 📊 Built-in statistics and progress tracking
- 🔒 Handles authentication and disclaimers automatically
- 📄 Supports multiple document formats (PDF, DJVU, DOC, etc.)

## Prerequisites

- Node.js 16+ 
- npm or yarn
- AWS account (only if using S3 storage)

## Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd planning-document-scraper
```

2. **Install dependencies:**
```bash
npm install
```

3. **Create environment file:**
```bash
cp .env.example .env
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# S3 Configuration (required only for S3 storage modes)
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
S3_PREFIX=planning-docs
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Optional: Override default behavior
# S3_ENABLED=true
# KEEP_LOCAL_FILES=true
```

### AWS S3 Setup (Optional)

If you plan to use S3 storage, you'll need:

1. **Create an S3 bucket:**
```bash
aws s3 mb s3://your-bucket-name
```

2. **Set up AWS credentials** (choose one method):

   **Option A: Environment Variables**
   ```bash
   export AWS_ACCESS_KEY_ID=your-access-key
   export AWS_SECRET_ACCESS_KEY=your-secret-key
   ```

   **Option B: AWS Credentials File**
   ```bash
   aws configure
   ```

   **Option C: IAM Roles** (if running on EC2)
   - Attach an IAM role with S3 permissions to your EC2 instance

3. **Required S3 permissions:**
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:PutObjectAcl",
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::your-bucket-name/*"
        }
    ]
}
```

## Usage

### Basic Usage

```bash
node scrape.mjs <APPLICATION_ID> [--storage=MODE]
```

### Storage Modes

| Mode | Description | Files Location |
|------|-------------|---------------|
| `local` | Save files locally only (default) | `downloads_<APPLICATION_ID>/` |
| `s3` | Upload to S3 only, no local files | `s3://bucket/prefix/application_id/` |
| `both` | Save locally AND upload to S3 | Both locations |

### Examples

**1. Local storage only (default):**
```bash
node scrape.mjs 2461047
```

**2. S3 storage only:**
```bash
node scrape.mjs 2461047 --storage=s3
```

**3. Both local and S3 storage:**
```bash
node scrape.mjs 2461047 --storage=both
```

**4. Multiple applications:**
```bash
# Process multiple applications
node scrape.mjs 2461047 --storage=s3
node scrape.mjs 2461048 --storage=s3
node scrape.mjs 2461049 --storage=both
```

## Output Structure

### Local Files
```
downloads_<APPLICATION_ID>/
├── 12345_Site_Plan.pdf
├── 12346_Floor_Plans.pdf
└── 12347_Planning_Statement.pdf
```

### S3 Structure
```
s3://your-bucket/planning-docs/
└── <APPLICATION_ID>/
    ├── 12345_Site_Plan.pdf
    ├── 12346_Floor_Plans.pdf
    └── 12347_Planning_Statement.pdf
```

## File Naming Convention

Files are automatically renamed using the pattern:
```
<DOCUMENT_ID>_<CLEANED_TITLE>.pdf
```

Examples:
- `12345_Site_Plan.pdf`
- `12346_Architectural_Drawings.pdf`
- `12347_Planning_Statement.pdf`

## Advanced Configuration

### Custom S3 Configuration

```env
# Custom S3 settings
S3_BUCKET=my-planning-docs-bucket
S3_REGION=eu-west-1
S3_PREFIX=council-documents/meath
```

### Performance Tuning

The scraper includes built-in delays between downloads to be respectful to the server:

```javascript
// Default: 1 second delay between downloads
await new Promise(resolve => setTimeout(resolve, 1000));
```

To modify this, edit the delay in `downloadAllDocuments()` function.

## Monitoring & Debugging

### Statistics Output

The scraper provides detailed statistics:

```
📊 Download Summary (S3 mode):
✅ Successfully downloaded: 15 files
❌ Failed downloads: 0 files
☁️  S3 uploads: 15 successful, 0 failed
📊 Total uploaded: 45.7 MB
🌐 S3 Location: s3://my-bucket/planning-docs/2461047/
```

### Debug Files

If downloads fail, debug files are automatically created:
- `debug-viewfiles-<index>.html` - ViewFiles page content
- `debug-viewpdf-<index>.html` - PDF viewer page content
- `debug-links.txt` - List of all discovered document links

### Verbose Logging

The application provides detailed logging for each step:
- 🔄 Process indicators
- 📥 Download progress
- ☁️ S3 upload status
- ✅ Success confirmations
- ❌ Error details

## Troubleshooting

### Common Issues

**1. S3 Upload Fails**
```
❌ S3 upload failed: The specified bucket does not exist
```
**Solution:** Verify your S3 bucket name and ensure it exists in the specified region.

**2. AWS Credentials Not Found**
```
❌ Unable to locate credentials
```
**Solution:** Set up AWS credentials using one of the methods in the AWS S3 Setup section.

**3. No Documents Found**
```
⚠️  No documents found to download.
```
**Solution:** Verify the application ID exists and has associated documents.

**4. Network Timeouts**
```
❌ Failed to download: timeout of 30000ms exceeded
```
**Solution:** Check your internet connection and try again. The scraper will continue with remaining files.

### Environment Variables Troubleshooting

**Check current configuration:**
```bash
# Verify environment variables are set
echo $S3_BUCKET
echo $AWS_ACCESS_KEY_ID
```

**Test AWS connectivity:**
```bash
aws s3 ls s3://your-bucket-name
```

## Development

### Project Structure

```
planning-document-scraper/
├── scrape.mjs              # Main scraper application
├── s3-uploader.mjs         # S3 upload module
├── package.json            # Dependencies
├── .env                    # Environment configuration
├── .env.example            # Environment template
└── README.md              # This file
```

### Adding New Features

1. **Custom storage backends:** Extend the storage mode system
2. **Additional document sources:** Modify the scraping logic
3. **Enhanced filtering:** Add document type filtering
4. **Batch processing:** Create scripts for multiple applications

### Dependencies

```json
{
  "axios": "^1.6.0",
  "axios-cookiejar-support": "^4.0.7",
  "cheerio": "^1.0.0-rc.12",
  "tough-cookie": "^4.1.3",
  "@aws-sdk/client-s3": "^3.450.0",
  "@aws-sdk/lib-storage": "^3.450.0",
  "dotenv": "^16.3.1"
}
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review debug files generated during failures
3. Create an issue with detailed error logs and configuration