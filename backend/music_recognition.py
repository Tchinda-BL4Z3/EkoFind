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
import cgi

PORT = 3001

class MusicHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[Python] {format % args}")
    
    def do_POST(self):
        if self.path != '/identify':
            self.send_error(404, "Not found")
            return
        
        content_type = self.headers.get('Content-Type', '')
        
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': content_type}
        )
        
        file_item = form.getfirst('audio')
        
        if not file_item:
            self.send_error(400, "No file")
            return
        
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            tmp.write(file_item)
            tmp_path = tmp.name
        
        try:
            # Generate fingerprint
            fp_result = subprocess.run(
                ['fpcalc', '-json', tmp_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if fp_result.returncode != 0:
                raise Exception("fpcalc failed")
            
            fp_data = json.loads(fp_result.stdout)
            fingerprint = fp_data.get('fingerprint', '')
            
            if not fingerprint:
                raise Exception("No fingerprint")
            
            # Query AcoustID
            import urllib.request
            import urllib.parse
            
            data = urllib.parse.urlencode({
                'clientversion': 'ekofind/1.0',
                'duration': fp_data.get('duration', 0),
                'fingerprint': fingerprint,
                'meta': 'recordings+releasegroups'
            })
            
            url = 'https://api.acoustid.org/v2/lookup?' + data
            response = urllib.request.urlopen(url, timeout=15)
            result = json.loads(response.read().decode())
            
            results = result.get('results', [])
            
            for r in results:
                if 'recordings' in r and r['recordings']:
                    rec = r['recordings'][0]
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "status": "success",
                        "result": {
                            "title": rec.get('title', 'Unknown'),
                            "artist": rec.get('artist', 'Unknown Artist'),
                            "album": "",
                            "link": ""
                        }
                    }).encode())
                    return
            
            raise Exception("No match")
            
        except Exception as e:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode())
        finally:
            os.unlink(tmp_path)

if __name__ == '__main__':
    print(f"[Python] Music Service on port {PORT}")
    server = HTTPServer(('', PORT), MusicHandler)
    server.serve_forever()