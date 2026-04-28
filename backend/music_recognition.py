#!/usr/bin/env python3
"""
Music Recognition Microservice using Chromaprint/AcoustID
"""

import os
import sys
import json
import subprocess
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler
import re

PORT = 3001

class MusicHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[Python] {format % args}")
    
    def do_POST(self):
        if self.path != '/identify':
            self.send_error(404, "Not found")
            return
        
        content_type = self.headers.get('Content-Type', '')
        content_length = int(self.headers.get('Content-Length', 0))
        
        print(f"[Python] Content-Type: {content_type}, Length: {content_length}")
        
        if 'multipart/form-data' not in content_type:
            print(f"[Python] Not multipart")
            self.send_error(400, "Expected multipart/form-data")
            return
        
        try:
            boundary = content_type.split('boundary=')[-1].strip()
        except:
            self.send_error(400, "No boundary")
            return
        
        body = self.rfile.read(content_length)
        print(f"[Python] Body starts with: {body[:100]}")
        
        audio_data = None
        filename = 'audio.m4a'
        
        boundary_bytes = ('--' + boundary).encode()
        parts = body.split(boundary_bytes)
        
        print(f"[Python] Found {len(parts)} parts")
        
        for part in parts:
            if b'Content-Disposition' in part and b'name="audio"' in part:
                header_end = part.find(b'\r\n\r\n')
                if header_end != -1:
                    audio_data = part[header_end + 4:]
                    fname_match = re.search(b'filename="([^"]+)"', part)
                    if fname_match:
                        filename = fname_match.group(1).decode()
                    print(f"[Python] Found audio: {filename}, size: {len(audio_data)}")
                    break
        
        if not audio_data or len(audio_data) < 100:
            print(f"[Python] No audio data found, body sample: {body[:200]}")
            self.send_error(400, "No audio file or too small")
            return
        
        suffix = '.m4a' if '.m4a' in filename else '.mp3' if '.mp3' in filename else '.wav'
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name
        
        try:
            print(f"[Python] Processing {filename} ({len(audio_data)} bytes)...")
            
            fp_result = subprocess.run(
                ['fpcalc', '-json', tmp_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if fp_result.returncode != 0:
                raise Exception("fpcalc failed: " + fp_result.stderr)
            
            fp_data = json.loads(fp_result.stdout)
            fingerprint = fp_data.get('fingerprint', '')
            duration = fp_data.get('duration', 0)
            
            if not fingerprint:
                raise Exception("No fingerprint generated")
            
            print(f"[Python] Duration: {duration}s, fingerprint: {fingerprint[:50]}...")
            
            from urllib.request import urlopen, Request
            from urllib.parse import urlencode
            
            query_params = {
                'client': '8CmyGz6XyAM',
                'duration': int(duration),
                'fingerprint': fingerprint,
                'meta': 'recordings+releasegroups+compress'
            }
            
            print(f"[Python] Query params: {query_params}")
            
            data = urlencode(query_params)
            url = 'https://api.acoustid.org/v2/lookup?' + data
            print(f"[Python] URL: {url[:100]}...")
            req = Request(url, headers={'User-Agent': 'EkoFind/1.0'})
            
            print(f"[Python] Querying AcoustID...")
            
            with urlopen(req, timeout=15) as response:
                result = json.loads(response.read().decode())
            
            results = result.get('results', [])
            print(f"[Python] Got {len(results)} results from AcoustID")
            
            for r in results:
                if 'recordings' in r and r['recordings']:
                    rec = r['recordings'][0]
                    artists = rec.get('artists', [])
                    artist_name = artists[0].get('name', 'Unknown Artist') if artists else 'Unknown Artist'
                    
                    release_groups = r.get('releasegroups', [])
                    album = release_groups[0].get('title', '') if release_groups else ''
                    
                    print(f"[Python] Found: {rec.get('title')} - {artist_name}")
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "status": "success",
                        "result": {
                            "title": rec.get('title', 'Unknown'),
                            "artist": artist_name,
                            "album": album,
                            "link": ""
                        }
                    }).encode())
                    return
            
            raise Exception("No match found in AcoustID")
            
        except Exception as e:
            print(f"[Python] Error: {str(e)}")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode())
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

if __name__ == '__main__':
    print(f"[Python] Music Service on port {PORT}")
    server = HTTPServer(('', PORT), MusicHandler)
    server.serve_forever()