<?php

function handleYouTubeDownload() {
    $input = json_decode(file_get_contents('php://input'), true);
    $url = trim($input['url'] ?? '');

    if (empty($url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide a YouTube URL.']);
        return;
    }

    if (!preg_match('/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i', $url, $matches)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide a valid YouTube URL.']);
        return;
    }

    $id = $matches[1];
    $results = extractYouTubeMedia($id);

    if ($results && count($results) > 0) {
        echo json_encode(['success' => true, 'results' => $results]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Could not extract media. The video might be private or extraction failed.']);
    }
}

function extractYouTubeMedia($id) {
    // We'll use public Invidious instance APIs to get video information
    $instances = [
        'https://vid.puffyan.us',
        'https://invidious.namazso.eu',
        'https://inv.tux.pizza'
    ];
    
    $data = null;
    foreach ($instances as $instance) {
        $apiUrl = "{$instance}/api/v1/videos/{$id}";
        $json = fetchUrl($apiUrl);
        if ($json) {
            $data = json_decode($json, true);
            if ($data && isset($data['formatStreams'])) {
                break;
            }
        }
    }

    if (!$data || !isset($data['formatStreams'])) return null;

    $results = [];
    $title = $data['title'] ?? 'YouTube Video';
    $uploader = $data['author'] ?? 'YouTube User';
    
    // Find the best quality formatStream (contains both video and audio)
    $bestStream = null;
    $highestRes = 0;
    
    foreach ($data['formatStreams'] as $stream) {
        $res = isset($stream['resolution']) ? intval(str_replace('p', '', $stream['resolution'])) : 0;
        if ($res > $highestRes && strpos($stream['type'] ?? '', 'mp4') !== false) {
            $highestRes = $res;
            $bestStream = $stream;
        }
    }
    
    // Fallback if no mp4 found
    if (!$bestStream && count($data['formatStreams']) > 0) {
        $bestStream = $data['formatStreams'][0];
    }
    
    // Add the best combined stream
    if ($bestStream && isset($bestStream['url'])) {
        $results[] = [
            'id' => 'yt-' . $id,
            'title' => mb_substr($title, 0, 200),
            'description' => $title,
            'thumbnail' => "https://i.ytimg.com/vi/{$id}/hqdefault.jpg",
            'downloadUrl' => $bestStream['url'],
            'isVideo' => true,
            'ext' => 'mp4',
            'uploader' => $uploader,
        ];
    }
    
    return count($results) > 0 ? $results : null;
}
