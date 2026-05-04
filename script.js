// ========== DOM ELEMENTS ==========
const urlInput = document.getElementById('urlInput');
const pasteBtn = document.getElementById('pasteBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusMsg = document.getElementById('statusMsg');
const resultsSection = document.getElementById('resultsSection');
const resultsGrid = document.getElementById('resultsGrid');
const clearResults = document.getElementById('clearResults');
const platformTabs = document.getElementById('platformTabs');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mainNav = document.getElementById('mainNav');
const header = document.getElementById('header');
const faqList = document.getElementById('faqList');
const bgParticles = document.getElementById('bgParticles');

// ========== BACKGROUND PARTICLES ==========
function createParticles() {
  const colors = ['#E040FB', '#FF5252', '#FFD740', '#448AFF', '#69F0AE', '#B388FF'];
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    const size = Math.random() * 200 + 50;
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = Math.random() * 100 + '%';
    particle.style.animationDelay = Math.random() * 10 + 's';
    particle.style.animationDuration = (Math.random() * 15 + 15) + 's';
    bgParticles.appendChild(particle);
  }
}
createParticles();

// ========== HEADER SCROLL ==========
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const scroll = window.scrollY;
  header.classList.toggle('scrolled', scroll > 50);
  lastScroll = scroll;
});

// ========== MOBILE MENU ==========
mobileMenuBtn.addEventListener('click', () => {
  mobileMenuBtn.classList.toggle('open');
  mainNav.classList.toggle('open');
});

// Close mobile menu on link click
mainNav.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenuBtn.classList.remove('open');
    mainNav.classList.remove('open');
  });
});

// ========== PLATFORM TABS ==========
let currentPlatform = 'instagram';
platformTabs.querySelectorAll('.platform-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    platformTabs.querySelector('.active').classList.remove('active');
    tab.classList.add('active');
    currentPlatform = tab.dataset.platform;
    urlInput.placeholder = `Paste ${tab.innerText.trim()} link here...`;
  });
});

// ========== PASTE BUTTON ==========
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
    urlInput.focus();
    showStatus('Link pasted! Click Download to proceed.', 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (err) {
    showStatus('Could not read clipboard. Please paste manually.', 'error');
    setTimeout(() => clearStatus(), 3000);
  }
});

// ========== URL VALIDATION ==========
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
}

// ========== STATUS MESSAGES ==========
function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg ' + type;
}
function clearStatus() {
  statusMsg.textContent = '';
  statusMsg.className = 'status-msg';
}

// ========== FORMAT HELPERS ==========
function formatDuration(seconds) {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// ========== DOWNLOAD HANDLER ==========
downloadBtn.addEventListener('click', handleDownload);
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleDownload();
});

async function handleDownload() {
  const url = urlInput.value.trim();

  if (!url) {
    showStatus('Please paste a video URL first.', 'error');
    urlInput.focus();
    return;
  }

  if (!isValidUrl(url)) {
    showStatus('Please enter a valid URL (e.g., https://...)', 'error');
    return;
  }

  // Show loading state
  setLoading(true);
  clearStatus();

  try {
    let action = 'download';
    if (currentPlatform === 'facebook') action = 'download_facebook';
    else if (currentPlatform === 'youtube') action = 'download_youtube';
    else if (currentPlatform === 'x') action = 'download_x';

    const response = await fetch(`api.php?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    // Check if the server returned HTML (error page) instead of JSON
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") === -1) {
      const text = await response.text();
      console.error("Server returned non-JSON response:", text.substring(0, 200));
      
      if (text.includes("Cannot POST") || text.includes("404")) {
        throw new Error("API File Not Found. If you are testing locally, please restart your Node server. If on cPanel, ensure all extractor PHP files are uploaded.");
      } else if (text.includes("500") || text.includes("Fatal error")) {
        throw new Error("Server Configuration Error. Please ensure facebook_extractor.php and other extractor files are in the exact same folder as api.php.");
      } else {
        throw new Error("Server returned an invalid response. Make sure you uploaded all files correctly.");
      }
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to process the URL.');
    }

    if (data.success && data.results && data.results.length > 0) {
      showStatus('Content found! Scroll down to download.', 'success');
      renderResults(data.results);
    } else {
      showStatus('No downloadable content found at this URL.', 'error');
    }
  } catch (error) {
    showStatus(error.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  const btnContent = downloadBtn.querySelector('.btn-content');
  const btnLoading = downloadBtn.querySelector('.btn-loading');
  downloadBtn.disabled = loading;
  btnContent.style.display = loading ? 'none' : 'flex';
  btnLoading.style.display = loading ? 'flex' : 'none';
}

// ========== RENDER RESULTS ==========
function renderResults(results) {
  resultsGrid.innerHTML = '';
  resultsSection.style.display = 'block';

  results.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.animationDelay = (index * 0.1) + 's';

    const typeLabel = item.isVideo ? 'Video' : 'Photo';
    const duration = item.isVideo && item.duration ? formatDuration(item.duration) : '';
    const description = item.description || item.title || 'Instagram Media';
    const truncatedDesc = description.length > 80 ? description.substring(0, 80) + '...' : description;

    const thumbUrl = item.thumbnail || '';
    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" alt="Preview" loading="lazy" onerror="this.style.display='none'">`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">
           <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
         </div>`;

    const downloadUrl = `api.php?action=proxy&url=${encodeURIComponent(item.downloadUrl)}&filename=insdonall-${item.id}.${item.ext}`;

    card.innerHTML = `
      <div class="result-thumb">
        ${thumbHtml}
        <span class="result-type-badge">${typeLabel}</span>
        ${duration ? `<span class="result-duration">${duration}</span>` : ''}
      </div>
      <div class="result-info">
        <p class="result-title">${escapeHtml(truncatedDesc)}</p>
        <div class="result-meta">
          ${item.uploader ? `<span>@${escapeHtml(item.uploader)}</span>` : ''}
          ${item.likeCount ? `<span>❤ ${formatNumber(item.likeCount)}</span>` : ''}
        </div>
        <div class="result-actions">
          <a href="${downloadUrl}" class="result-dl-btn" download target="_blank">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download ${typeLabel}
          </a>
        </div>
      </div>
    `;

    resultsGrid.appendChild(card);
  });

  // Scroll to results
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== CLEAR RESULTS ==========
clearResults.addEventListener('click', () => {
  resultsGrid.innerHTML = '';
  resultsSection.style.display = 'none';
  urlInput.value = '';
  clearStatus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ========== FAQ ACCORDION ==========
faqList.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');

    // Close all
    faqList.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));

    // Toggle current
    if (!isOpen) item.classList.add('open');
  });
});

// ========== SMOOTH SCROLL NAV HIGHLIGHT ==========
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link[href^="#"]');

function updateActiveNav() {
  const scrollY = window.scrollY + 200;
  sections.forEach(section => {
    const top = section.offsetTop;
    const height = section.offsetHeight;
    const id = section.getAttribute('id');
    if (scrollY >= top && scrollY < top + height) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + id) {
          link.classList.add('active');
        }
      });
    }
  });
}
window.addEventListener('scroll', updateActiveNav);

// ========== INTERSECTION OBSERVER FOR ANIMATIONS ==========
const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

document.querySelectorAll('.step-card, .feature-card, .faq-item').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(30px)';
  el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  observer.observe(el);
});
