// app.js - Entry point for cPanel Passenger
// Passenger requires the app to be exported, not started with .listen()
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== All server logic imported from server core ==========
// (We inline everything here so Passenger can pick it up)

function isValidInstagramUrl(url) {
  return /^https?:\/\/(www\.)?instagram\.com\//i.test(url.trim());
}

function getShortcode(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

// --- Method 1: Direct page scraping ---
async function extractFromPage(url) {
  try {
    const response = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const results = [];

    const ogImages = [...html.matchAll(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi)];
    const ogVideos = [...html.matchAll(/<meta\s+(?:property|name)="og:video(?::url)?"\s+content="([^"]+)"/gi)];
    const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
    const title = ogTitle ? decodeHtmlEntities(ogTitle[1]) : 'Instagram Media';

    const jsonData = extractEmbeddedJson(html);
    if (jsonData) {
      const mediaItems = parseEmbeddedMedia(jsonData);
      if (mediaItems.length > 0) return mediaItems;
    }

    if (ogVideos.length > 0) {
      ogVideos.forEach((match, i) => {
        results.push({ id: getShortcode(url) || `video-${i}`, title, description: '', thumbnail: ogImages[0] ? ogImages[0][1] : '', downloadUrl: match[1], isVideo: true, ext: 'mp4', uploader: extractUsername(title) });
      });
    }
    if (ogImages.length > 0 && results.length === 0) {
      ogImages.forEach((match, i) => {
        results.push({ id: getShortcode(url) || `photo-${i}`, title, description: '', thumbnail: match[1], downloadUrl: match[1], isVideo: false, ext: 'jpg', uploader: extractUsername(title) });
      });
    }
    if (results.length > 0) return results;
    throw new Error('No media in page');
  } catch (err) { throw err; }
}

function extractEmbeddedJson(html) {
  const patterns = [
    /window\._sharedData\s*=\s*({.+?});<\/script>/s,
    /window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);<\/script>/s,
    /<script\s+type="application\/ld\+json"\s*>(\{.+?\})<\/script>/gs,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) { try { return JSON.parse(match[1]); } catch (e) { continue; } }
  }
  return null;
}

function parseEmbeddedMedia(data) {
  const results = [];
  try {
    let media = null;
    if (data.entry_data?.PostPage) media = data.entry_data.PostPage[0]?.graphql?.shortcode_media;
    else if (data.graphql?.shortcode_media) media = data.graphql.shortcode_media;
    else if (data.items) { for (const item of data.items) results.push(...parseMediaItem(item)); return results; }
    if (media) {
      if (media.edge_sidecar_to_children?.edges) {
        media.edge_sidecar_to_children.edges.forEach((edge, i) => {
          const node = edge.node;
          results.push({ id: node.shortcode || `item-${i}`, title: media.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Media', description: '', thumbnail: node.display_url || '', downloadUrl: node.video_url || node.display_url || '', isVideo: node.is_video || false, ext: node.is_video ? 'mp4' : 'jpg', uploader: media.owner?.username || '', duration: node.video_duration || 0 });
        });
      } else {
        results.push({ id: media.shortcode || 'media', title: media.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Media', description: '', thumbnail: media.display_url || '', downloadUrl: media.video_url || media.display_url || '', isVideo: media.is_video || false, ext: media.is_video ? 'mp4' : 'jpg', uploader: media.owner?.username || '', duration: media.video_duration || 0, likeCount: media.edge_media_preview_like?.count || 0 });
      }
    }
  } catch (e) {}
  return results;
}

function parseMediaItem(item) {
  const results = [];
  if (item.carousel_media) {
    item.carousel_media.forEach((cm, i) => {
      results.push({ id: cm.id || `carousel-${i}`, title: item.caption?.text || 'Instagram Media', description: '', thumbnail: cm.image_versions2?.candidates?.[0]?.url || '', downloadUrl: cm.video_versions?.[0]?.url || cm.image_versions2?.candidates?.[0]?.url || '', isVideo: cm.media_type === 2, ext: cm.media_type === 2 ? 'mp4' : 'jpg', uploader: item.user?.username || '' });
    });
  } else {
    results.push({ id: item.id || 'media', title: item.caption?.text || 'Instagram Media', description: '', thumbnail: item.image_versions2?.candidates?.[0]?.url || '', downloadUrl: item.video_versions?.[0]?.url || item.image_versions2?.candidates?.[0]?.url || '', isVideo: item.media_type === 2, ext: item.media_type === 2 ? 'mp4' : 'jpg', uploader: item.user?.username || '' });
  }
  return results;
}

// --- Method 2: Embed API ---
async function extractFromEmbed(url) {
  try {
    const shortcode = getShortcode(url);
    if (!shortcode) throw new Error('No shortcode');
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
    const response = await fetch(embedUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const results = [];

    const videoMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
    const imgMatch = html.match(/"display_url"\s*:\s*"([^"]+)"/);
    const captionMatch = html.match(/"caption"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]+)"/);
    const userMatch = html.match(/"username"\s*:\s*"([^"]+)"/);

    const caption = captionMatch ? decodeUnicode(captionMatch[1]) : 'Instagram Media';
    const username = userMatch ? userMatch[1] : '';
    const videoUrl = videoMatch ? decodeUnicode(videoMatch[1]) : null;
    const imageUrl = imgMatch ? decodeUnicode(imgMatch[1]) : null;

    if (videoUrl) {
      results.push({ id: shortcode, title: caption.substring(0, 200), description: caption, thumbnail: imageUrl || '', downloadUrl: videoUrl, isVideo: true, ext: 'mp4', uploader: username });
    } else if (imageUrl) {
      results.push({ id: shortcode, title: caption.substring(0, 200), description: caption, thumbnail: imageUrl, downloadUrl: imageUrl, isVideo: false, ext: 'jpg', uploader: username });
    }

    // Carousel
    const allDisplayUrls = [...html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)];
    const allVideoUrls = [...html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)];
    if (allDisplayUrls.length > 1 || allVideoUrls.length > 1) {
      results.length = 0;
      const seen = new Set();
      allVideoUrls.forEach((m, i) => { const u = decodeUnicode(m[1]); if (!seen.has(u)) { seen.add(u); results.push({ id: `${shortcode}-v${i}`, title: caption.substring(0, 200), description: caption, thumbnail: allDisplayUrls[i] ? decodeUnicode(allDisplayUrls[i][1]) : '', downloadUrl: u, isVideo: true, ext: 'mp4', uploader: username }); } });
      allDisplayUrls.forEach((m, i) => { const u = decodeUnicode(m[1]); if (!seen.has(u)) { seen.add(u); results.push({ id: `${shortcode}-p${i}`, title: caption.substring(0, 200), description: caption, thumbnail: u, downloadUrl: u, isVideo: false, ext: 'jpg', uploader: username }); } });
    }

    if (results.length > 0) return results;
    throw new Error('No media in embed');
  } catch (err) { throw err; }
}

// --- Combined extraction ---
async function extractMedia(url) {
  const errors = [];
  try { const r = await extractFromPage(url); if (r.length > 0) return r; } catch (e) { errors.push(e.message); }
  try { const r = await extractFromEmbed(url); if (r.length > 0) return r; } catch (e) { errors.push(e.message); }
  throw new Error('Could not extract media. Please check that the URL is from a public Instagram post and try again.');
}

function decodeHtmlEntities(str) { return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'"); }
function decodeUnicode(str) { return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\\//g, '/'); }
function extractUsername(title) { const m = title.match(/@([A-Za-z0-9_.]+)/); return m ? m[1] : ''; }

// ========== FACEBOOK EXTRACTOR ==========
async function extractFacebookMedia(url) {
  const response = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
  const html = await response.text();
  const ogVideoMatch = html.match(/<meta\s+(?:property|name)="og:video(?:[:a-zA-Z0-9]*)"\s+content="([^"]+)"/i);
  const ogImageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i);
  const ogTitleMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
  let videoUrl = ogVideoMatch ? decodeHtmlEntities(ogVideoMatch[1]) : '';
  const thumbnail = ogImageMatch ? decodeHtmlEntities(ogImageMatch[1]) : '';
  const title = ogTitleMatch ? decodeHtmlEntities(ogTitleMatch[1]) : 'Facebook Video';
  if (!videoUrl) {
    const scriptVideoHd = html.match(/"playable_url_quality_hd":"([^"]+)"/i);
    const scriptVideo = html.match(/"playable_url":"([^"]+)"/i);
    if (scriptVideoHd) videoUrl = scriptVideoHd[1].replace(/\\\//g, '/');
    else if (scriptVideo) videoUrl = scriptVideo[1].replace(/\\\//g, '/');
  }
  if (videoUrl) {
    return [{ id: 'fb-' + Date.now(), title: title.substring(0, 200), description: '', thumbnail, downloadUrl: videoUrl, isVideo: true, ext: 'mp4', uploader: 'Facebook User' }];
  }
  return null;
}

// ========== YOUTUBE EXTRACTOR ==========
async function extractYouTubeMedia(url) {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (!match) throw new Error('Invalid YouTube URL');
  const id = match[1];
  const instances = ['https://vid.puffyan.us', 'https://invidious.namazso.eu', 'https://inv.tux.pizza'];
  let data = null;
  for (const instance of instances) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${id}`);
      if (res.ok) { data = await res.json(); if (data && data.formatStreams) break; }
    } catch(e) {}
  }
  if (!data || !data.formatStreams) return null;
  let bestStream = null, highestRes = 0;
  data.formatStreams.forEach(stream => {
    const res = stream.resolution ? parseInt(stream.resolution.replace('p', '')) : 0;
    if (res > highestRes && (stream.type || '').includes('mp4')) { highestRes = res; bestStream = stream; }
  });
  if (!bestStream && data.formatStreams.length > 0) bestStream = data.formatStreams[0];
  if (bestStream && bestStream.url) {
    return [{ id: 'yt-' + id, title: (data.title || 'YouTube Video').substring(0, 200), description: data.title || '', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, downloadUrl: bestStream.url, isVideo: true, ext: 'mp4', uploader: data.author || 'YouTube User' }];
  }
  return null;
}

// ========== X / TWITTER EXTRACTOR ==========
async function extractXMedia(url) {
  const match = url.match(/(?:x|twitter)\.com\/.+\/status\/([0-9]+)/i);
  if (!match) throw new Error('Invalid X/Twitter URL');
  const id = match[1];
  const res = await fetch(`https://api.vxtwitter.com/i/status/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.text) return null;
  const results = [];
  const title = data.text;
  const uploader = data.user_name || 'X User';
  if (data.media_extended && Array.isArray(data.media_extended)) {
    data.media_extended.forEach((media, i) => {
      if (media.type === 'video' || media.type === 'gif') {
        results.push({ id: `x-${id}-${i}`, title: title.substring(0, 200), description: title, thumbnail: media.thumbnail_url || '', downloadUrl: media.url || '', isVideo: true, ext: 'mp4', uploader });
      } else if (media.type === 'image') {
        results.push({ id: `x-${id}-${i}`, title: title.substring(0, 200), description: title, thumbnail: media.url || '', downloadUrl: media.url || '', isVideo: false, ext: 'jpg', uploader });
      }
    });
  }
  return results.length > 0 ? results : null;
}

// ========== API ROUTES ==========
app.post('/api.php', async (req, res) => {
  const action = req.query.action;
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Please provide a URL.' });

    let results = [];
    if (action === 'download') {
      if (!isValidInstagramUrl(url)) return res.status(400).json({ error: 'Invalid Instagram URL.' });
      let cleanUrl = url.trim();
      if (!cleanUrl.endsWith('/')) cleanUrl += '/';
      results = await extractMedia(cleanUrl);
    } else if (action === 'download_facebook') {
      results = await extractFacebookMedia(url);
    } else if (action === 'download_youtube') {
      results = await extractYouTubeMedia(url);
    } else if (action === 'download_x') {
      results = await extractXMedia(url);
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (results && results.length > 0) {
      res.json({ success: true, results });
    } else {
      res.status(500).json({ error: 'Could not extract media. The post might be private or blocked.' });
    }
  } catch (error) {
    console.error('Download error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to process the URL.' });
  }
});

app.get('/api.php', async (req, res) => {
  if (req.query.action === 'proxy') {
    try {
      const { url, filename } = req.query;
      if (!url) return res.status(400).json({ error: 'No URL provided' });
      const response = await fetch(url, { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Referer': 'https://www.instagram.com/' } });
      if (!response.ok) throw new Error('Failed to fetch');
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const ext = contentType.includes('video') ? 'mp4' : 'jpg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename || `insdonall.${ext}`}"`);
      if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      res.status(500).json({ error: 'Failed to download file.' });
    }
  } else {
    res.status(400).send('Invalid action');
  }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// ========== FOR LOCAL DEV: start server ==========
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`\n  ✨ InsDonAll running at http://localhost:${PORT}\n`));
}

// ========== FOR CPANEL PASSENGER: export app ==========
module.exports = app;
