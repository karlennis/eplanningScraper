import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(
    import.meta.url);

const axios = require('axios');
const cheerio = require('cheerio');
const tough = require('tough-cookie');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
import fs from 'fs';
import path from 'path';
import s3Uploader from './s3-uploader.mjs';

const jar = new tough.CookieJar();
axiosCookieJarSupport(axios);

const client = axios.create({
    jar,
    withCredentials: true,
});

// Parse command line arguments
const args = process.argv.slice(2);
const applicationId = args.find(arg => !arg.startsWith('--'));
let storageMode = 'local';
const storageArg = args.find(arg => arg.startsWith('--storage='));
if (storageArg) {
    const parts = storageArg.split('=');
    if (parts.length > 1 && parts[1]) {
        storageMode = parts[1];
    }
}

if (!applicationId) {
    console.log(`
📋 Usage: node scrape.mjs <APPLICATION_ID> [--storage=MODE]

Storage Modes:
  --storage=local     Save files locally only (default)
  --storage=s3        Upload to S3 only (no local files)
  --storage=both      Save locally AND upload to S3

Examples:
  node scrape.mjs 2461047                    # Local storage only
  node scrape.mjs 2461047 --storage=s3       # S3 only
  node scrape.mjs 2461047 --storage=both     # Local + S3

Environment Variables (required for S3):
  S3_BUCKET           Your S3 bucket name
  S3_REGION           AWS region (default: us-east-1)
  S3_PREFIX           S3 folder prefix (default: planning-docs)
  AWS_ACCESS_KEY_ID   AWS access key
  AWS_SECRET_ACCESS_KEY AWS secret key
`);
    process.exit(1);
}

// Validate storage mode
const validModes = ['local', 's3', 'both'];
if (!validModes.includes(storageMode)) {
    console.error(`❌ Invalid storage mode: ${storageMode}`);
    console.error(`Valid modes: ${validModes.join(', ')}`);
    process.exit(1);
}

// Override environment variables based on storage mode
if (storageMode === 's3' || storageMode === 'both') {
    process.env.S3_ENABLED = 'true';
    process.env.KEEP_LOCAL_FILES = storageMode === 'both' ? 'true' : 'false';
} else {
    process.env.S3_ENABLED = 'false';
    process.env.KEEP_LOCAL_FILES = 'true';
}

console.log(`🚀 Starting scraper for application ${applicationId}`);
console.log(`📦 Storage mode: ${storageMode.toUpperCase()}`);

// Validate S3 configuration if needed
if (storageMode === 's3' || storageMode === 'both') {
    if (!process.env.S3_BUCKET) {
        console.error(`❌ S3_BUCKET environment variable is required for storage mode: ${storageMode}`);
        console.error('Set it with: export S3_BUCKET=your-bucket-name');
        process.exit(1);
    }
}

const BASE_URL = `https://idocswebdpss.meathcoco.ie/iDocsWebDPSS`;

// Create downloads folder (only if keeping local files or S3 is disabled)
const downloadsFolder = `downloads_${applicationId}`;
if (s3Uploader.shouldKeepLocalFiles() || !s3Uploader.isEnabled()) {
    if (!fs.existsSync(downloadsFolder)) {
        fs.mkdirSync(downloadsFolder);
        console.log(`📁 Created folder: ${downloadsFolder}`);
    }
}

async function downloadFile(url, filename, index, total) {
    try {
        console.log(`📥 Downloading ${index}/${total}: ${filename}`);
        console.log(`🔗 ViewFiles URL: ${url}`);

        // First, get the ViewFiles page to extract the real PDF URL
        const viewResponse = await client.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
            }
        });

        // Parse the ViewFiles page to find the iframe src with the actual PDF
        const $view = cheerio.load(viewResponse.data);
        let actualPdfUrl = null;

        // Look for iframe with PDF source
        $view('iframe').each((_, el) => {
            const src = $view(el).attr('src');
            if (src && src.includes('.pdf')) {
                // Convert relative path to full URL
                if (src.startsWith('.\\files\\') || src.startsWith('./files/')) {
                    const cleanPath = src.replace(/^\.\\/, '').replace(/^\.\//, '');
                    actualPdfUrl = `${BASE_URL}/${cleanPath}`;
                } else if (!src.startsWith('http')) {
                    actualPdfUrl = `${BASE_URL}/${src}`;
                } else {
                    actualPdfUrl = src;
                }
                console.log(`🔗 Found PDF URL: ${actualPdfUrl}`);
                return false; // break
            }
        });

        // Also check for direct links (for mobile/iOS fallback)
        if (!actualPdfUrl) {
            $view('a').each((_, el) => {
                const href = $view(el).attr('href');
                if (href && href.includes('.pdf')) {
                    if (href.startsWith('.\\files\\') || href.startsWith('./files/')) {
                        const cleanPath = href.replace(/^\.\\/, '').replace(/^\.\//, '');
                        actualPdfUrl = `${BASE_URL}/${cleanPath}`;
                    } else if (!href.startsWith('http')) {
                        actualPdfUrl = `${BASE_URL}/${href}`;
                    } else {
                        actualPdfUrl = href;
                    }
                    console.log(`🔗 Found PDF URL in link: ${actualPdfUrl}`);
                    return false; // break
                }
            });
        }

        if (!actualPdfUrl) {
            console.log(`⚠️  No PDF URL found in ViewFiles page`);
            fs.writeFileSync(`debug-viewfiles-${index}.html`, viewResponse.data);
            console.log(`📄 ViewFiles page saved to debug-viewfiles-${index}.html`);
            throw new Error('No PDF URL found in ViewFiles page');
        }

        // Clean the URL (remove PDF viewer parameters)
        actualPdfUrl = actualPdfUrl.split('#')[0];
        console.log(`📥 Accessing PDF URL: ${actualPdfUrl}`);

        // Get the ViewPdf page first to check if it's another layer
        const pdfPageResponse = await client.get(actualPdfUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': url,
                'Connection': 'keep-alive'
            }
        });

        const contentType = pdfPageResponse.headers['content-type'];
        console.log(`📄 PDF URL Content-Type: ${contentType}`);

        let finalPdfUrl = actualPdfUrl;

        // If it's HTML, parse it to find the real PDF
        if (contentType && contentType.includes('text/html')) {
            console.log(`🔄 PDF URL returned HTML, parsing for real PDF link...`);

            const $pdfPage = cheerio.load(pdfPageResponse.data);
            let realPdfUrl = null;

            $pdfPage('iframe, embed, object').each((_, el) => {
                const src = $pdfPage(el).attr('src') || $pdfPage(el).attr('data');
                if (src && (src.includes('.pdf') || src.includes('pdf'))) {
                    if (!src.startsWith('http')) {
                        realPdfUrl = `${BASE_URL}/${src.replace(/^\.?[\/\\]/, '')}`;
                    } else {
                        realPdfUrl = src;
                    }
                    console.log(`🔗 Found real PDF URL: ${realPdfUrl}`);
                    return false;
                }
            });

            // Also check for direct links or JavaScript redirects
            if (!realPdfUrl) {
                $pdfPage('a').each((_, el) => {
                    const href = $pdfPage(el).attr('href');
                    if (href && (href.includes('.pdf') || href.includes('GetDocument'))) {
                        if (!href.startsWith('http')) {
                            realPdfUrl = `${BASE_URL}/${href.replace(/^\.?[\/\\]/, '')}`;
                        } else {
                            realPdfUrl = href;
                        }
                        console.log(`🔗 Found real PDF URL in link: ${realPdfUrl}`);
                        return false;
                    }
                });
            }

            // Look for JavaScript variables or window.open calls
            if (!realPdfUrl) {
                const pageText = pdfPageResponse.data;
                const jsMatches = pageText.match(/(?:window\.open|location\.href|src\s*=\s*['"])(.*?\.pdf.*?)['"\)]/gi);
                if (jsMatches && jsMatches.length > 0) {
                    const match = jsMatches[0];
                    realPdfUrl = match.replace(/.*['"]([^'"]+)['"].*/, '$1');
                    if (!realPdfUrl.startsWith('http')) {
                        realPdfUrl = `${BASE_URL}/${realPdfUrl.replace(/^\.?[\/\\]/, '')}`;
                    }
                    console.log(`🔗 Found PDF URL in JavaScript: ${realPdfUrl}`);
                }
            }

            if (realPdfUrl) {
                finalPdfUrl = realPdfUrl.split('#')[0]; // Remove parameters
            } else {
                console.log(`⚠️  No real PDF URL found in ViewPdf page`);
                fs.writeFileSync(`debug-viewpdf-${index}.html`, pdfPageResponse.data);
                console.log(`📄 ViewPdf page saved to debug-viewpdf-${index}.html`);
                throw new Error('No real PDF URL found in ViewPdf page');
            }
        }

        console.log(`📥 Downloading final PDF: ${finalPdfUrl}`);

        // Download the actual PDF file with proper binary handling
        const finalPdfResponse = await client.get(finalPdfUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/pdf,*/*',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'identity',
                'Referer': actualPdfUrl,
                'Connection': 'keep-alive'
            }
        });

        // Check the final response
        const finalContentType = finalPdfResponse.headers['content-type'];
        console.log(`📄 Final Content-Type: ${finalContentType}`);
        console.log(`📄 Final Content-Length: ${finalPdfResponse.headers['content-length']}`);

        // Verify we got binary data, not HTML
        const responseData = Buffer.from(finalPdfResponse.data);
        const firstBytes = responseData.slice(0, 10).toString();

        if (firstBytes.includes('<!DOCTYPE') || firstBytes.includes('<html')) {
            console.log(`⚠️  Still got HTML response instead of PDF`);
            fs.writeFileSync(`debug-final-response-${index}.html`, responseData.toString());
            throw new Error('Still receiving HTML instead of PDF content after multiple redirects');
        }

        if (!firstBytes.startsWith('%PDF-')) {
            console.log(`⚠️  Response doesn't start with PDF header. First bytes: ${firstBytes}`);
            fs.writeFileSync(`debug-final-response-${index}.bin`, responseData);
            console.log(`📄 Binary response saved for analysis`);
        }

        // Process the filename
        const pdfFilename = filename.replace(/\.djvu$/, '.pdf');
        let s3Result = null;

        // Upload to S3 if enabled using the s3Uploader module
        if (s3Uploader.isEnabled()) {
            try {
                s3Result = await s3Uploader.upload(responseData, pdfFilename, applicationId);
                console.log(`☁️  S3 upload successful: ${pdfFilename}`);
            } catch (s3Error) {
                console.error(`⚠️  S3 upload failed, continuing with local storage: ${s3Error.message}`);
            }
        }

        // Save locally if enabled or if S3 upload failed
        if (s3Uploader.shouldKeepLocalFiles() || (!s3Uploader.isEnabled() || !s3Result)) {
            const filePath = path.join(downloadsFolder, pdfFilename);
            fs.writeFileSync(filePath, responseData);
            console.log(`💾 Saved locally: ${pdfFilename} (${responseData.length} bytes)`);
        }

        // Summary message
        if (s3Uploader.isEnabled() && s3Result && !s3Uploader.shouldKeepLocalFiles()) {
            console.log(`✅ Uploaded to S3 only: ${pdfFilename} (${responseData.length} bytes)`);
        } else if (s3Uploader.isEnabled() && s3Result && s3Uploader.shouldKeepLocalFiles()) {
            console.log(`✅ Saved locally + S3: ${pdfFilename} (${responseData.length} bytes)`);
        } else {
            console.log(`✅ Saved locally: ${pdfFilename} (${responseData.length} bytes)`);
        }

        return Promise.resolve();

    } catch (error) {
        console.error(`❌ Failed to download ${filename}:`, error.message);
        if (error.response) {
            console.error(`❌ Status: ${error.response.status}`);
            console.error(`❌ Headers:`, error.response.headers);
        }
        throw error;
    }
}

function getFilenameFromUrl(url, docTitle = '') {
    // Extract document ID from URL
    const docidMatch = url.match(/docid=(\d+)/);

    if (docidMatch) {
        const docid = docidMatch[1];

        // Clean the document title if provided
        if (docTitle && docTitle.trim()) {
            const cleanTitle = docTitle.trim()
                .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid filename chars
                .replace(/\s+/g, '_') // Replace spaces with underscores
                .substring(0, 100); // Limit length

            return `${docid}_${cleanTitle}.pdf`;
        }

        // Fallback to just docid
        return `document_${docid}.pdf`;
    }

    // Final fallback
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `document_${timestamp}_${random}.pdf`;
}

async function downloadAllDocuments(links) {
    if (links.length === 0) {
        console.log('⚠️  No documents found to download.');
        return;
    }

    console.log(`\n🚀 Starting download of ${links.length} documents...\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < links.length; i++) {
        const linkObj = links[i];
        const filename = getFilenameFromUrl(linkObj.url, linkObj.title);

        try {
            await downloadFile(linkObj.url, filename, i + 1, links.length);
            successCount++;

            // Small delay between downloads to be respectful
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            failCount++;
            console.error(`❌ Failed to download file ${i + 1}: ${error.message}`);
        }
    }

    console.log(`\n📊 Download Summary (${storageMode.toUpperCase()} mode):`);
    console.log(`✅ Successfully downloaded: ${successCount} files`);
    console.log(`❌ Failed downloads: ${failCount} files`);

    // Print S3 summary if enabled
    if (s3Uploader.isEnabled()) {
        s3Uploader.printSummary(applicationId);
    }

    // Print local summary if applicable
    if (s3Uploader.shouldKeepLocalFiles() || !s3Uploader.isEnabled()) {
        console.log(`📁 Files saved to: ${downloadsFolder}`);
    }
}

async function acceptDisclaimerAndGetDocs(appId) {
    try {
        const url = `${BASE_URL}/copyright.aspx?catalog=planning&id=${appId}`;

        // Step 1: Load the page with the disclaimer
        console.log('🔄 Loading disclaimer page...');
        const response = await client.get(url);
        const $disclaimer = cheerio.load(response.data);

        // Step 2: Build form data from all hidden fields
        const formData = new URLSearchParams();

        $disclaimer('input[type="hidden"]').each((_, el) => {
            const name = $disclaimer(el).attr('name');
            const value = $disclaimer(el).val();
            if (name) formData.append(name, value);
        });

        // Add checkbox and submit button
        formData.append('chkAgree', 'on');
        formData.append('btnAgree', 'I Agree');

        const formAction = $disclaimer('form').attr('action');
        if (!formAction) {
            throw new Error('❌ Form action not found');
        }

        // Step 3: Submit the form
        console.log('🔄 Submitting disclaimer agreement...');
        const submitUrl = `${BASE_URL}/${formAction}`;
        const confirmRes = await client.post(submitUrl, formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log("✅ Submitted 'I Agree' form, status:", confirmRes.status);

        // Parse the returned page
        const $confirm = cheerio.load(confirmRes.data);

        // Extract hidden fields for postback
        const postBackData = new URLSearchParams();
        ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION'].forEach(field => {
            const val = $confirm(`input[name="${field}"]`).val();
            if (val) postBackData.append(field, val);
        });

        // Simulate the View Files button
        postBackData.append('__EVENTTARGET', 'btnViewFiles');
        postBackData.append('__EVENTARGUMENT', '');

        // Submit postback to trigger file listing
        console.log('🔄 Fetching file list...');
        const viewFilesRes = await client.post(submitUrl, postBackData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const $files = cheerio.load(viewFilesRes.data);
        const links = [];

        // Look for table rows containing document information
        $files('tr').each((_, row) => {
            const $row = $files(row);
            const link = $row.find('a[href*="ViewFiles.aspx"]');

            if (link.length > 0) {
                const href = link.attr('href');
                const docidMatch = href.match(/docid=(\d+)/);

                if (docidMatch) {
                    const docid = docidMatch[1];

                    // Get document title from the second column (Comment)
                    const cells = $row.find('td');
                    let docTitle = '';
                    if (cells.length >= 2) {
                        docTitle = $files(cells[1]).text().trim();
                    }

                    // Use the actual ViewFiles URL directly
                    const viewFilesUrl = `${BASE_URL}/${href}`;

                    // Create download object with title and URL
                    links.push({
                        url: viewFilesUrl,
                        title: docTitle,
                        docid: docid
                    });
                }
            }
        });

        console.log(`✅ Found ${links.length} documents:`);
        links.forEach((linkObj, index) => {
            console.log(`${index + 1}. ${linkObj.url} - ${linkObj.title}`);
        });

        // Save debug info about the links
        const linkTexts = links.map(l => `${l.url} - ${l.title}`);
        fs.writeFileSync('debug-links.txt', linkTexts.join('\n'));
        console.log("📄 Links saved to 'debug-links.txt'");

        // Download all documents
        await downloadAllDocuments(links);

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

acceptDisclaimerAndGetDocs(applicationId);