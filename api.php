<?php
/**
 * InsDonAll - Instagram Downloader API (PHP Backend)
 * Works on any shared hosting with PHP 7.4+ and cURL
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Browser headers to avoid bot detection
define('USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

// ========== MAIN ROUTER ==========
$action = $_GET['action'] ?? '';

if ($action === 'download' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    handleDownload();
} elseif ($action === 'download_facebook' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once 'facebook_extractor.php';
    handleFacebookDownload();
} elseif ($action === 'download_youtube' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once 'youtube_extractor.php';
    handleYouTubeDownload();
} elseif ($action === 'download_x' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once 'x_extractor.php';
    handleXDownload();
} elseif ($action === 'proxy') {
    handleProxy();
} else {
    echo json_encode(['error' => 'Invalid action']);
}

// ========== DOWNLOAD HANDLER ==========
function handleDownload() {
    $input = json_decode(file_get_contents('php://input'), true);
    $url = trim($input['url'] ?? '');

    if (empty($url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide an Instagram URL.']);
        return;
    }

    if (!preg_match('#^https?://(www\.)?instagram\.com/.+#i', $url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide a valid Instagram URL.']);
        return;
    }

    // Normalize URL
    if (substr($url, -1) !== '/') $url .= '/';

    $results = extractMedia($url);

    if ($results && count($results) > 0) {
        echo json_encode(['success' => true, 'results' => $results]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Could not extract media. Please check that the URL is from a public Instagram post and try again.']);
    }
}

// ========== COMBINED EXTRACTION ==========
function extractMedia($url) {
    // Method 1: Embed page
    $results = extractFromEmbed($url);
    if ($results && count($results) > 0) return $results;

    // Method 2: Direct page scraping
    $results = extractFromPage($url);
    if ($results && count($results) > 0) return $results;

    // Method 3: OEmbed API
    $results = extractFromOembed($url);
    if ($results && count($results) > 0) return $results;

    return null;
}

// ========== METHOD 1: Instagram Embed Page ==========
function extractFromEmbed($url) {
    $shortcode = getShortcode($url);
    if (!$shortcode) return null;

    // Try both /p/ and /reel/ embed URLs
    $embedUrls = [
        "https://www.instagram.com/p/{$shortcode}/embed/",
        "https://www.instagram.com/reel/{$shortcode}/embed/",
    ];

    foreach ($embedUrls as $embedUrl) {
        $html = fetchUrl($embedUrl);
        if (!$html) continue;

        $results = [];

        // Extract video URLs
        preg_match_all('/"video_url"\s*:\s*"([^"]+)"/', $html, $videoMatches);
        // Extract image URLs
        preg_match_all('/"display_url"\s*:\s*"([^"]+)"/', $html, $imageMatches);
        // Extract caption
        preg_match('/"caption"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]*)"/', $html, $captionMatch);
        // Extract username
        preg_match('/"username"\s*:\s*"([^"]+)"/', $html, $userMatch);

        $caption = isset($captionMatch[1]) ? decodeUnicodeStr($captionMatch[1]) : 'Instagram Media';
        $username = $userMatch[1] ?? '';

        $videoUrls = [];
        $imageUrls = [];

        if (!empty($videoMatches[1])) {
            foreach ($videoMatches[1] as $v) {
                $videoUrls[] = decodeUnicodeStr($v);
            }
        }
        if (!empty($imageMatches[1])) {
            foreach ($imageMatches[1] as $img) {
                $imageUrls[] = decodeUnicodeStr($img);
            }
        }

        $seen = [];

        // Add videos
        foreach ($videoUrls as $i => $vUrl) {
            if (in_array($vUrl, $seen)) continue;
            $seen[] = $vUrl;
            $results[] = [
                'id' => $shortcode . '-v' . $i,
                'title' => mb_substr($caption, 0, 200),
                'description' => $caption,
                'thumbnail' => $imageUrls[$i] ?? ($imageUrls[0] ?? ''),
                'downloadUrl' => $vUrl,
                'isVideo' => true,
                'ext' => 'mp4',
                'uploader' => $username,
            ];
        }

        // Add images (skip if already added as video thumbnail)
        foreach ($imageUrls as $i => $imgUrl) {
            if (in_array($imgUrl, $seen)) continue;
            $seen[] = $imgUrl;
            $results[] = [
                'id' => $shortcode . '-p' . $i,
                'title' => mb_substr($caption, 0, 200),
                'description' => $caption,
                'thumbnail' => $imgUrl,
                'downloadUrl' => $imgUrl,
                'isVideo' => false,
                'ext' => 'jpg',
                'uploader' => $username,
            ];
        }

        if (count($results) > 0) return $results;
    }

    return null;
}

// ========== METHOD 2: Direct Page Scraping ==========
function extractFromPage($url) {
    $html = fetchUrl($url);
    if (!$html) return null;

    $results = [];

    // Extract og:video
    preg_match_all('/<meta\s+(?:property|name)="og:video(?::url)?"\s+content="([^"]+)"/i', $html, $ogVideos);
    // Extract og:image
    preg_match_all('/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i', $html, $ogImages);
    // Extract og:title
    preg_match('/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i', $html, $ogTitle);

    $title = isset($ogTitle[1]) ? htmlspecialchars_decode($ogTitle[1]) : 'Instagram Media';
    $shortcode = getShortcode($url) ?? 'media';

    // Try to extract JSON data from script tags
    $jsonResults = extractFromScriptTags($html);
    if ($jsonResults && count($jsonResults) > 0) return $jsonResults;

    if (!empty($ogVideos[1])) {
        foreach ($ogVideos[1] as $i => $videoUrl) {
            $results[] = [
                'id' => $shortcode . '-v' . $i,
                'title' => $title,
                'description' => '',
                'thumbnail' => $ogImages[1][$i] ?? ($ogImages[1][0] ?? ''),
                'downloadUrl' => htmlspecialchars_decode($videoUrl),
                'isVideo' => true,
                'ext' => 'mp4',
                'uploader' => extractUsernameFromTitle($title),
            ];
        }
    }

    if (empty($results) && !empty($ogImages[1])) {
        foreach ($ogImages[1] as $i => $imageUrl) {
            $results[] = [
                'id' => $shortcode . '-p' . $i,
                'title' => $title,
                'description' => '',
                'thumbnail' => htmlspecialchars_decode($imageUrl),
                'downloadUrl' => htmlspecialchars_decode($imageUrl),
                'isVideo' => false,
                'ext' => 'jpg',
                'uploader' => extractUsernameFromTitle($title),
            ];
        }
    }

    return count($results) > 0 ? $results : null;
}

// Extract media data from embedded script tags
function extractFromScriptTags($html) {
    $patterns = [
        '/window\._sharedData\s*=\s*({.+?});<\/script>/s',
        '/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);<\/script>/s',
    ];

    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $html, $match)) {
            $data = json_decode($match[1], true);
            if ($data) {
                return parseJsonMediaData($data);
            }
        }
    }
    return null;
}

function parseJsonMediaData($data) {
    $results = [];
    $media = null;

    if (isset($data['entry_data']['PostPage'][0]['graphql']['shortcode_media'])) {
        $media = $data['entry_data']['PostPage'][0]['graphql']['shortcode_media'];
    } elseif (isset($data['graphql']['shortcode_media'])) {
        $media = $data['graphql']['shortcode_media'];
    }

    if (!$media) return null;

    $caption = $media['edge_media_to_caption']['edges'][0]['node']['text'] ?? 'Instagram Media';
    $username = $media['owner']['username'] ?? '';

    // Carousel
    if (isset($media['edge_sidecar_to_children']['edges'])) {
        foreach ($media['edge_sidecar_to_children']['edges'] as $i => $edge) {
            $node = $edge['node'];
            $results[] = [
                'id' => $node['shortcode'] ?? "item-{$i}",
                'title' => mb_substr($caption, 0, 200),
                'description' => '',
                'thumbnail' => $node['display_url'] ?? '',
                'downloadUrl' => $node['video_url'] ?? $node['display_url'] ?? '',
                'isVideo' => $node['is_video'] ?? false,
                'ext' => ($node['is_video'] ?? false) ? 'mp4' : 'jpg',
                'uploader' => $username,
                'duration' => $node['video_duration'] ?? 0,
            ];
        }
    } else {
        // Single post
        $results[] = [
            'id' => $media['shortcode'] ?? 'media',
            'title' => mb_substr($caption, 0, 200),
            'description' => '',
            'thumbnail' => $media['display_url'] ?? '',
            'downloadUrl' => $media['video_url'] ?? $media['display_url'] ?? '',
            'isVideo' => $media['is_video'] ?? false,
            'ext' => ($media['is_video'] ?? false) ? 'mp4' : 'jpg',
            'uploader' => $username,
            'duration' => $media['video_duration'] ?? 0,
            'likeCount' => $media['edge_media_preview_like']['count'] ?? 0,
        ];
    }

    return count($results) > 0 ? $results : null;
}

// ========== METHOD 3: OEmbed API ==========
function extractFromOembed($url) {
    $oembedUrl = 'https://api.instagram.com/oembed/?url=' . urlencode($url);
    $json = fetchUrl($oembedUrl);
    if (!$json) return null;

    $data = json_decode($json, true);
    if (!$data) return null;

    $shortcode = getShortcode($url) ?? 'media';
    $title = $data['title'] ?? 'Instagram Media';
    $author = $data['author_name'] ?? '';
    $thumbnail = $data['thumbnail_url'] ?? '';

    if ($thumbnail) {
        return [[
            'id' => $shortcode,
            'title' => mb_substr($title, 0, 200),
            'description' => $title,
            'thumbnail' => $thumbnail,
            'downloadUrl' => $thumbnail,
            'isVideo' => false,
            'ext' => 'jpg',
            'uploader' => $author,
        ]];
    }

    return null;
}

// ========== PROXY DOWNLOAD ==========
function handleProxy() {
    $url = $_GET['url'] ?? '';
    $filename = $_GET['filename'] ?? 'insdonall-download';

    if (empty($url)) {
        http_response_code(400);
        echo json_encode(['error' => 'No URL provided']);
        return;
    }

    $url = urldecode($url);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => USER_AGENT,
        CURLOPT_HTTPHEADER => [
            'Referer: https://www.instagram.com/',
        ],
        CURLOPT_HEADER => true,
    ]);

    $response = curl_exec($ch);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
    $body = substr($response, $headerSize);
    curl_close($ch);

    if (!$body) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to download file.']);
        return;
    }

    $ext = 'bin';
    if (strpos($contentType, 'video') !== false) $ext = 'mp4';
    elseif (strpos($contentType, 'image') !== false) $ext = 'jpg';

    header('Content-Type: ' . $contentType);
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($body));
    header('Cache-Control: no-cache');

    echo $body;
    exit;
}

// ========== UTILITY FUNCTIONS ==========

function fetchUrl($url) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => USER_AGENT,
        CURLOPT_HTTPHEADER => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
            'Sec-Fetch-Dest: document',
            'Sec-Fetch-Mode: navigate',
            'Sec-Fetch-Site: none',
            'Cache-Control: no-cache',
        ],
        CURLOPT_ENCODING => '',
    ]);

    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 400 && $result) {
        return $result;
    }
    return null;
}

function getShortcode($url) {
    if (preg_match('#instagram\.com/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)#', $url, $m)) {
        return $m[1];
    }
    return null;
}

function decodeUnicodeStr($str) {
    $str = preg_replace_callback('/\\\\u([0-9a-fA-F]{4})/', function ($m) {
        return mb_convert_encoding(pack('H*', $m[1]), 'UTF-8', 'UCS-2BE');
    }, $str);
    $str = str_replace('\\/', '/', $str);
    return $str;
}

function extractUsernameFromTitle($title) {
    if (preg_match('/@([A-Za-z0-9_.]+)/', $title, $m)) return $m[1];
    if (preg_match('/^([A-Za-z0-9_.]+)\s/', $title, $m)) return $m[1];
    return '';
}
