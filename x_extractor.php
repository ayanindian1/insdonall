<?php

function handleXDownload() {
    $input = json_decode(file_get_contents('php://input'), true);
    $url = trim($input['url'] ?? '');

    if (empty($url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide an X (Twitter) URL.']);
        return;
    }

    if (!preg_match('/(?:x|twitter)\.com\/.+\/status\/([0-9]+)/i', $url, $matches)) {
        http_response_code(400);
        echo json_encode(['error' => 'Please provide a valid X (Twitter) status URL.']);
        return;
    }

    $id = $matches[1];
    $results = extractXMedia($id);

    if ($results && count($results) > 0) {
        echo json_encode(['success' => true, 'results' => $results]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Could not extract media. The post might be private or contain no video.']);
    }
}

function extractXMedia($id) {
    // Use api.vxtwitter.com for easy public access to media
    $apiUrl = "https://api.vxtwitter.com/i/status/{$id}";
    $json = fetchUrl($apiUrl);
    
    if (!$json) return null;
    $data = json_decode($json, true);
    if (!$data || !isset($data['text'])) return null;

    $results = [];
    $title = $data['text'] ?? 'X Video';
    $uploader = $data['user_name'] ?? 'X User';
    
    // Check media_extended for rich info
    if (isset($data['media_extended']) && is_array($data['media_extended'])) {
        foreach ($data['media_extended'] as $i => $media) {
            if ($media['type'] === 'video' || $media['type'] === 'gif') {
                $results[] = [
                    'id' => 'x-' . $id . '-' . $i,
                    'title' => mb_substr($title, 0, 200),
                    'description' => $title,
                    'thumbnail' => $media['thumbnail_url'] ?? '',
                    'downloadUrl' => $media['url'] ?? '',
                    'isVideo' => true,
                    'ext' => 'mp4',
                    'uploader' => $uploader,
                ];
            } elseif ($media['type'] === 'image') {
                $results[] = [
                    'id' => 'x-' . $id . '-' . $i,
                    'title' => mb_substr($title, 0, 200),
                    'description' => $title,
                    'thumbnail' => $media['url'] ?? '',
                    'downloadUrl' => $media['url'] ?? '',
                    'isVideo' => false,
                    'ext' => 'jpg',
                    'uploader' => $uploader,
                ];
            }
        }
    }
    
    return count($results) > 0 ? $results : null;
}
