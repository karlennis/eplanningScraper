/**
 * S3 Upload Module for Planning Document Scraper
 * Handles all AWS S3 upload functionality
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

class S3Uploader {
    constructor() {
        this.enabled = process.env.S3_ENABLED === 'true';
        this.bucket = process.env.S3_BUCKET;
        this.region = process.env.S3_REGION || 'us-east-1';
        this.prefix = process.env.S3_PREFIX || 'planning-docs';
        this.keepLocalFiles = process.env.KEEP_LOCAL_FILES !== 'false'; // Default to true

        this.client = null;
        this.stats = {
            uploaded: 0,
            failed: 0,
            totalBytes: 0
        };

        this.initialize();
    }

    initialize() {
        if (!this.enabled) {
            return;
        }

        if (!this.bucket) {
            console.error('❌ S3_BUCKET environment variable is required when S3_ENABLED=true');
            process.exit(1);
        }

        this.client = new S3Client({
            region: this.region,
            // AWS credentials will be automatically detected from:
            // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
            // 2. AWS credentials file (~/.aws/credentials)
            // 3. IAM roles (if running on EC2)
        });

        console.log(`☁️  S3 Storage enabled: s3://${this.bucket}/${this.prefix}/`);
        console.log(`📁 Keep local files: ${this.keepLocalFiles}`);
    }

    /**
     * Upload a file buffer to S3
     * @param {Buffer} fileBuffer - The file content as a buffer
     * @param {string} filename - The filename to use in S3
     * @param {string} applicationId - The planning application ID for folder organization
     * @returns {Promise<Object|null>} Upload result or null if S3 disabled
     */
    async upload(fileBuffer, filename, applicationId) {
        if (!this.enabled || !this.client) {
            return null;
        }

        try {
            const s3Key = `${this.prefix}/${applicationId}/${filename}`;

            console.log(`☁️  Uploading to S3: s3://${this.bucket}/${s3Key}`);

            const upload = new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucket,
                    Key: s3Key,
                    Body: fileBuffer,
                    ContentType: this.getContentType(filename),
                    Metadata: {
                        'application-id': applicationId,
                        'uploaded-at': new Date().toISOString(),
                        'source': 'meath-planning-scraper',
                        'file-size': fileBuffer.length.toString()
                    }
                }
            });

            const result = await upload.done();

            this.stats.uploaded++;
            this.stats.totalBytes += fileBuffer.length;

            console.log(`✅ S3 Upload complete: ${filename}`);
            return result;

        } catch (error) {
            this.stats.failed++;
            console.error(`❌ S3 Upload failed for ${filename}:`, error.message);
            throw error;
        }
    }

    /**
     * Get appropriate content type for file
     * @param {string} filename - The filename
     * @returns {string} Content type
     */
    getContentType(filename) {
        const extension = filename.toLowerCase().split('.').pop();

        const contentTypes = {
            'pdf': 'application/pdf',
            'djvu': 'image/vnd.djvu',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'txt': 'text/plain',
            'html': 'text/html',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png'
        };

        return contentTypes[extension] || 'application/octet-stream';
    }

    /**
     * Get S3 URL for a file
     * @param {string} filename - The filename
     * @param {string} applicationId - The planning application ID
     * @returns {string} S3 URL
     */
    getS3Url(filename, applicationId) {
        if (!this.enabled) {
            return null;
        }

        const s3Key = `${this.prefix}/${applicationId}/${filename}`;
        return `s3://${this.bucket}/${s3Key}`;
    }

    /**
     * Get public HTTP URL for a file (if bucket allows public access)
     * @param {string} filename - The filename
     * @param {string} applicationId - The planning application ID
     * @returns {string} HTTP URL
     */
    getPublicUrl(filename, applicationId) {
        if (!this.enabled) {
            return null;
        }

        const s3Key = `${this.prefix}/${applicationId}/${filename}`;
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${s3Key}`;
    }

    /**
     * Get upload statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            totalMB: Math.round(this.stats.totalBytes / 1024 / 1024 * 100) / 100
        };
    }

    /**
     * Print summary of uploads
     * @param {string} applicationId - The planning application ID
     */
    printSummary(applicationId) {
        if (!this.enabled) {
            return;
        }

        const stats = this.getStats();
        console.log(`☁️  S3 uploads: ${stats.uploaded} successful, ${stats.failed} failed`);
        console.log(`📊 Total uploaded: ${stats.totalMB} MB`);
        console.log(`🌐 S3 Location: s3://${this.bucket}/${this.prefix}/${applicationId}/`);
    }

    /**
     * Check if S3 is enabled
     * @returns {boolean} True if S3 is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Check if local files should be kept
     * @returns {boolean} True if local files should be kept
     */
    shouldKeepLocalFiles() {
        return this.keepLocalFiles;
    }
}

// Export singleton instance
export default new S3Uploader();