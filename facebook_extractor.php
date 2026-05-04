<?php

function handleFacebookDownload() {
    $input = json_decode(file_get_contents('php://input'), true);
    $url = trim($input['url'] ?? '');

    if (empty($url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide a Facebook URL.']);
        return;
    }

    if (!preg_match('/facebook\.com|fb\.watch|fb\.gg/i', $url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide a valid Facebook URL.']);
        return;
    }

    $results = extractFacebookMedia($url);

    if ($results && count($results) > 0) {
        echo json_encode(['success' => true, 'results' => $results]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Could not extract media. The video might be private or Facebook blocked the request.']);
    }
}

function extractFacebookMedia($url) {
    // We can use the fetchUrl function from api.php since this file is included there
    $html = fetchUrl($url);
    if (!$html) return null;

    $results = [];

    // Try to find og:video
    preg_match('/<meta\s+(?:property|name)="og:video(?:[:a-zA-Z0-9]*)"\s+content="([^"]+)"/i', $html, $ogVideo);
    preg_match('/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i', $html, $ogImage);
    preg_match('/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i', $html, $ogTitle);

    $videoUrl = isset($ogVideo[1]) ? htmlspecialchars_decode($ogVideo[1]) : '';
    $thumbnail = isset($ogImage[1]) ? htmlspecialchars_decode($ogImage[1]) : '';
    $title = isset($ogTitle[1]) ? htmlspecialchars_decode($ogTitle[1]) : 'Facebook Video';

    // Sometimes the video URL is inside a script tag as 'playable_url' or 'playable_url_quality_hd'
    if (!$videoUrl) {
        // Try HD first
        if (preg_match('/"playable_url_quality_hd":"([^"]+)"/i', $html, $scriptVideoHd)) {
            $videoUrl = str_replace('\\/', '/', $scriptVideoHd[1]);
        } elseif (preg_match('/"playable_url":"([^"]+)"/i', $html, $scriptVideo)) {
            $videoUrl = str_replace('\\/', '/', $scriptVideo[1]);
        }
    }

    if ($videoUrl) {
        $results[] = [
            'id' => 'fb-' . uniqid(),
            'title' => mb_substr($title, 0, 200),
            'description' => '',
            'thumbnail' => $thumbnail,
            'downloadUrl' => $videoUrl,
            'isVideo' => true,
            'ext' => 'mp4',
            'uploader' => 'Facebook User',
        ];
        return $results;
    }

    return null;
}
