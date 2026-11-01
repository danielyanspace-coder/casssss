import{writeFile}from'node:fs/promises';
import{COMPANY,LICENSE,PARTNERS,footerHtml}from'../public/legal.js';
const html=footerHtml();const year=new Date().getFullYear();
await writeFile(new URL('../public/legal-summary.js',import.meta.url),`// Generated from legal.js: same metadata and footer, without document bodies.\nexport const COMPANY=${JSON.stringify(COMPANY)};\nexport const LICENSE=${JSON.stringify(LICENSE)};\nexport const PARTNERS=${JSON.stringify(PARTNERS)};\nconst footer=${JSON.stringify(html)};\nexport function footerHtml(){return footer.replace(${JSON.stringify('© '+year)},'© '+new Date().getFullYear());}\n`);
