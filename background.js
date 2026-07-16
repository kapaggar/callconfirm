// background.js — MV3 service worker. Single job: fetch personalized letters
// from applicant.vridhamma.org on behalf of the page. l.php sends no CORS
// headers, so page JS on dipi.vridhamma.org can never read the response;
// the background fetch is exempt because host_permissions grants the host.
// The URL is allow-listed — this must not grow into a generic fetch proxy.
const LETTER_URL_RE = /^https:\/\/applicant\.vridhamma\.org\/l\.php\?a=/;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'dipi-letter-fetch') return;
  if (!LETTER_URL_RE.test(msg.url || '')) {
    sendResponse({ ok: false, error: 'URL not allowed' });
    return;
  }
  fetch(msg.url)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then((text) => sendResponse({ ok: true, text }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // keep the channel open for the async sendResponse
});
