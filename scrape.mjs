import { createRequire } from 'module';
const require = createRequire(
    import.meta.url);

const axios = require('axios');
const cheerio = require('cheerio');
const tough = require('tough-cookie');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
import fs from 'fs';

const jar = new tough.CookieJar();
axiosCookieJarSupport(axios);

const client = axios.create({
    jar,
    withCredentials: true,
});

const applicationId = process.argv[2];
if (!applicationId) {
    console.error('❌ Please provide an application ID as an argument.');
    process.exit(1);
}

const BASE_URL = `https://idocswebdpss.meathcoco.ie/iDocsWebDPSS`;

async function acceptDisclaimerAndGetDocs(appId) {
    try {
        const url = `${BASE_URL}/copyright.aspx?catalog=planning&id=${appId}`;

        // Step 1: Load the page with the disclaimer
        const response = await client.get(url);
        const $ = cheerio.load(response.data);

        // Step 2: Build form data from all hidden fields
        const formData = new URLSearchParams();

        $('input[type="hidden"]').each((_, el) => {
            const name = $(el).attr('name');
            const value = $(el).val();
            if (name) formData.append(name, value);
        });

        // Add checkbox and submit button
        formData.append('chkAgree', 'on');
        formData.append('btnAgree', 'I Agree');

        const formAction = $('form').attr('action');
        if (!formAction) {
            throw new Error('❌ Form action not found');
        }

        // Step 3: Submit the form
        const submitUrl = `${BASE_URL}/${formAction}`;
        const confirmRes = await client.post(submitUrl, formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log("✅ Submitted 'I Agree' form, status:", confirmRes.status);
        fs.writeFileSync('debug-response.html', confirmRes.data);
        console.log("📄 Response saved to 'debug-response.html'");
        // Parse the returned page
        const $$ = cheerio.load(confirmRes.data);

        // Extract hidden fields for postback
        const postBackData = new URLSearchParams();
        ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION'].forEach(field => {
            const val = $$(`input[name="${field}"]`).val();
            if (val) postBackData.append(field, val);
        });

        // Simulate the View Files button
        postBackData.append('__EVENTTARGET', 'btnViewFiles');
        postBackData.append('__EVENTARGUMENT', '');

        // Submit postback to trigger file listing
        const viewFilesRes = await client.post(submitUrl, postBackData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        fs.writeFileSync('view-files-response.html', viewFilesRes.data);
        console.log("📄 View Files response saved to 'view-files-response.html'");



        const $$$ = cheerio.load(viewFilesRes.data);
        const links = [];

        $$$('a').each((_, el) => {
            const href = $$$(el).attr('href');
            if (href && href.includes('download')) {
                links.push(`${BASE_URL}/${href}`);
            }
        });


        console.log(`✅ Found ${links.length} documents:`);
        links.forEach(link => console.log(link));

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}


acceptDisclaimerAndGetDocs(applicationId);