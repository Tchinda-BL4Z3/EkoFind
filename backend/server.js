require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const crypto = require('crypto');

const app = express(); 
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const uploadDir = 'upload';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir + '/', limits: { fileSize: 25 * 1024 * 1024 } });

// AudioTag API (FREE - 3 hours/month)
const AUDIOTAG_API_KEY = process.env.AUDIOTAG_API_KEY || '';

async function recognizeWithAudioTag(filePath) {
    if (!AUDIOTAG_API_KEY) {
        throw new Error("AudioTag API key not configured");
    }
    
    console.log('🎵 Sending to AudioTag...');
    
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('api_key', AUDIOTAG_API_KEY);
    form.append('skip', '20');
    
    const response = await axios.post('https://audiotag.info/api/', form, {
        headers: form.getHeaders(),
        timeout: 60000
    });
    
    console.log('📥 AudioTag response:', JSON.stringify(response.data).substring(0, 200));
    return response.data;
}

const AUDD_API_TOKEN = "17bcb9422e6c0214ad12d747f10c3d39";

const ACR_HOST = process.env.ACR_HOST || "api.acrcloud.com";
const ACR_ACCESS_KEY = process.env.ACR_ACCESS_KEY || "";
const ACR_SECRET_KEY = process.env.ACR_SECRET_KEY || "";

async function recognizeWithACRCloud(filePath) {
    if (!ACR_ACCESS_KEY || !ACR_SECRET_KEY) {
        throw new Error("ACRCloud credentials not configured");
    }
    
    console.log('🎵 ACRCloud starting...');
    const timestamp = Math.floor(Date.now() / 1000);
    const sampleBytes = fs.statSync(filePath).size;
    console.log('📄 File size:', sampleBytes);
    
    const httpMethod = 'POST';
    const httpUri = '/v1/identify';
    const dataType = 'audio';
    const signatureVersion = '1';
    
    const stringToSign = httpMethod + '\n' + httpUri + '\n' + ACR_ACCESS_KEY + '\n' + dataType + '\n' + signatureVersion + '\n' + timestamp;
    console.log('🔑 String to sign:', stringToSign);
    
    const signature = crypto.createHmac('sha1', ACR_SECRET_KEY)
        .update(stringToSign)
        .digest('base64');
    
    console.log('✅ Signature:', signature);
    
    const form = new FormData();
    form.append('access_key', ACR_ACCESS_KEY);
    form.append('sample', fs.createReadStream(filePath));
    form.append('sample_bytes', sampleBytes);
    form.append('timestamp', timestamp.toString());
    form.append('signature', signature);
    form.append('data_type', dataType);
    form.append('signature_version', signatureVersion);
    
    console.log('📤 Sending to ACRCloud...');
    const response = await axios.post('https://identify-eu-west-1.acrcloud.com/v1/identify', form, {
        headers: form.getHeaders(),
        timeout: 60000
    });
    
    console.log('📥 ACRCloud response:', JSON.stringify(response.data).substring(0, 300));
    return response.data;
}

const activeRecordings = new Map();
const cleanupInterval = 5 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [sessionId, recording] of activeRecordings.entries()) {
        if (now - recording.startTime > 15 * 60 * 1000) {
            if (fs.existsSync(recording.filePath)) {
                fs.unlinkSync(recording.filePath);
            }
            activeRecordings.delete(sessionId);
        }
    }
}, cleanupInterval);

app.post('/start-recording', (req, res) => {
    const { sessionId } = req.body;
    const fileName = `recording_${sessionId}_${Date.now()}.m4a`;
    const filePath = path.join(uploadDir, fileName);
    
    activeRecordings.set(sessionId, { filePath, startTime: Date.now() });
    
    res.json({ status: 'started', filePath });
});

app.post('/append-audio', upload.single('chunk'), async (req, res) => {
    const { sessionId } = req.body;
    
    if (!req.file) {
        return res.status(400).send("Pas de chunk audio.");
    }
    
    const recording = activeRecordings.get(sessionId);
    if (!recording) {
        fs.unlinkSync(req.file.path);
        return res.status(400).send("Session non trouvée.");
    }
    
    try {
        const existingData = fs.readFileSync(recording.filePath);
        const newData = fs.readFileSync(req.file.path);
        fs.writeFileSync(recording.filePath, Buffer.concat([existingData, newData]));
        fs.unlinkSync(req.file.path);
        res.json({ status: 'appended' });
    } catch (err) {
        console.error("Erreur append:", err);
        res.status(500).send("Erreur append");
    }
});

app.post('/stop-recording', upload.single('audio'), async (req, res) => {
    const { sessionId } = req.body;
    const recording = activeRecordings.get(sessionId);
    
    if (!recording && !req.file) {
        return res.status(400).send("Pas d'enregistrement.");
    }

    const filePath = req.file ? req.file.path : recording.filePath;
    
    if (recording) {
        activeRecordings.delete(sessionId);
    }

    try {
        const stat = fs.statSync(filePath);
        if (stat.size < 1000) {
            return res.json({ status: "error", message: "Audio trop court" });
        }

        // Try Python microservice first (port 3001)
        const { execSync } = require('child_process');
        
        try {
            console.log('🔄 Trying Python microservice on port 3001...');
            const pythonCmd = `curl -s -X POST http://localhost:3001/identify -F "audio=@${filePath}"`;
            const pythonResult = execSync(pythonCmd, { encoding: 'utf8', timeout: 60000 });
            const pyData = JSON.parse(pythonResult);
            
            if (pyData.status === 'success' && pyData.result) {
                console.log('✅ Recognized via Python:', pyData.result?.title);
                return res.json({
                    status: 'success',
                    result: {
                        title: pyData.result.title,
                        artist: pyData.result.artist,
                        album: pyData.result.album || 'Album inconnu',
                        link: pyData.result.link || '',
                        spotify: '',
                        appleMusic: '',
                        deezer: ''
                    }
                });
            } else {
                console.log('⚠️ Python service returned:', pyData.message || pyData.status);
                return res.json({ status: 'error', message: pyData.message || 'Music not recognized' });
            }
        } catch (pyError) {
            console.log('⚠️ Python service unavailable:', pyError.message);
            
            // Fallback to AudD with curl with retry
            let data = null;
            
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`🔄 Tentative ${attempt}/3 vers AudD...`);
                    const curlCmd = `curl -s --retry 3 --retry-delay 2 -X POST https://api.audd.io/ -F "api_token=${AUDD_API_TOKEN}" -F "file=@${filePath}" -F "return=apple_music,spotify" --max-time 90`;
                    const curlResponse = execSync(curlCmd, { encoding: 'utf8', timeout: 95000 });
                    data = JSON.parse(curlResponse);
                    break;
                } catch (curlError) {
                    console.log(`⚠️ Tentative ${attempt} echouee:`, curlError.message);
                    if (attempt === 3) {
                        data = { status: 'error', message: 'Connexion echouee apres 3 tentatives' };
                    }
                }
            }
            
            console.log('📨 AudD response:', data?.status);

            if (data?.status === 'success' && data?.result) {
                console.log(`✅ Reconnu: ${data.result.title} - ${data.result.artist}`);
                
                const result = {
                    title: data.result.title,
                    artist: data.result.artist,
                    album: data.result.album || 'Album inconnu',
                    link: data.result.song_link || '',
                    year: data.result || '',
                    label: data.result.label || '',
                    isrc: data.result.isrc || '',
                    type: data.result.type || 'Music',
                    appleMusic: data.result.apple_music?.url || '',
                    spotify: data.result.spotify?.url || '',
                    deezer: data.result.deezer?.url || '',
                    youtube: data.result.youtube?.url || '',
                    genre: data.result.genre || ''
                };
                
                return res.json({ status: 'success', result });
            }

            return res.json({ status: 'error', message: data?.message || 'Audio non reconnu' });
        }

        // Handle errors
    } catch (error) {
        console.error("Erreur identification:", error.message);
        res.status(500).json({ error: "Erreur lors de l'analyse." });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', activeRecordings: activeRecordings.size });
});

app.post('/identify', upload.single('audio'), async (req, res) => {
    console.log('📥 Requête identify reçue');
    console.log('📎 Fichier reçu:', req.file);
    console.log('📋 Body:', JSON.stringify(req.body).substring(0, 200));
    
    if (!req.file) {
        console.log('❌ Pas de fichier audio - Headers:', req.headers['content-type']);
        return res.status(400).json({ status: 'error', message: 'Pas de fichier audio' });
    }

    const filePath = req.file.path;
    console.log('📂 Chemin du fichier:', filePath);

    try {
        const stat = fs.statSync(filePath);
        console.log('📄 Taille du fichier:', stat.size);
        
        if (stat.size < 1000) {
            console.log('❌ Audio trop court');
            return res.json({ status: 'error', message: 'Audio trop court' });
        }

        // Try Python microservice first (port 3001)
        const { execSync } = require('child_process');
        
        try {
            console.log('🔄 Trying Python microservice on port 3001...');
            const pythonCmd = `curl -s -X POST http://localhost:3001/identify -F "audio=@${filePath}"`;
            const pythonResult = execSync(pythonCmd, { encoding: 'utf8', timeout: 60000 });
            const pyData = JSON.parse(pythonResult);
            
            if (pyData.status === 'success' && pyData.result) {
                console.log('✅ Recognized via Python:', pyData.result?.title);
                return res.json({
                    status: 'success',
                    result: {
                        title: pyData.result.title,
                        artist: pyData.result.artist,
                        album: pyData.result.album || 'Album inconnu',
                        link: pyData.result.link || '',
                        spotify: '',
                        appleMusic: '',
                        deezer: ''
                    }
                });
            } else {
                console.log('⚠️ Python service:', pyData.message || 'No match');
            }
        } catch (pyError) {
            console.log('⚠️ Python service unavailable:', pyError.message);
        }

        // Fallback: Try AudioTag first (FREE)
        if (AUDIOTAG_API_KEY) {
            try {
                const data = await recognizeWithAudioTag(filePath);
                
                if (data.status === 'success' && data.result && data.result.length > 0) {
                    const track = data.result[0];
                    console.log(`✅ AudioTag: ${track.title} - ${track.artist}`);
                    return res.json({
                        status: 'success',
                        result: {
                            title: track.title,
                            artist: track.artist,
                            album: track.album || 'Album inconnu',
                            link: ''
                        }
                    });
                }
            } catch (atError) {
                console.log('AudioTag failed:', atError.message);
            }
        }
        
        console.log('📊 Checking ACRCloud...', { key: !!ACR_ACCESS_KEY, secret: !!ACR_SECRET_KEY });
        
        // Try ACRCloud
        if (ACR_ACCESS_KEY && ACR_SECRET_KEY) {
            console.log('⏳ Trying ACRCloud...');
            try {
                const data = await recognizeWithACRCloud(filePath);
                console.log('📨 ACRCloud status:', data.status);
                
                if (data.status?.code === 0 && data.metadata) {
                    const music = data.metadata.music?.[0] || data.metadata.humming?.[0];
                    if (music) {
                        console.log(`✅ ACRCloud: ${music.title} - ${music.artists?.[0]?.name}`);
                        
                        const externalMeta = music.external_metadata || {};
                        const spotifyData = externalMeta.spotify || {};
                        const deezerData = externalMeta.deezer || {};
                        const appleData = externalMeta.apple_music || {};
                        
                        const title = music.title || '';
                        const artist = music.artists?.map(a => a.name).join(', ') || '';
                        const searchQuery = encodeURIComponent(`${title} ${artist}`.trim());
                        const songInfo = encodeURIComponent(`${title} ${artist}`.trim());
                        
                        return res.json({
                            status: 'success',
                            result: {
                                title: title,
                                artist: artist,
                                album: music.album?.name || music.release_date || 'Album inconnu',
                                type: data.metadata.music ? 'Music' : 'Podcast/Humming',
                                year: music.release_date ? new Date(music.release_date).getFullYear() : '',
                                duration: music.duration_ms ? Math.round(music.duration_ms / 1000) + 's' : '',
                                image: music.label || '',
                                spotify: spotifyData.url || `https://open.spotify.com/search/${songInfo}`,
                                appleMusic: appleData.url || `https://music.apple.com/search?term=${searchQuery}`,
                                deezer: deezerData.url || `https://www.deezer.com/search/${songInfo}`,
                                youtube: `https://www.youtube.com/results?search_query=${songInfo}`,
                                link: `https://www.google.com/search?q=${songInfo}`,
                                downloadUrl: '',
                                fileSize: ''
                            }
                        });
                    }
                }
            } catch (acrError) {
                console.log('ACRCloud failed:', acrError.message);
            }
        }
        
        // Try AudD with curl
        let data = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Tentative ${attempt}/3 vers AudD...`);
                const curlCmd = `curl -s --retry 3 --retry-delay 2 -X POST https://api.audd.io/ -F "api_token=${AUDD_API_TOKEN}" -F "file=@${filePath}" -F "return=apple_music,spotify" --max-time 90`;
                console.log('📤 Curl cmd:', curlCmd.substring(0, 100) + '...');
                const curlResponse = execSync(curlCmd, { encoding: 'utf8', timeout: 95000 });
                console.log('📥 AudD raw response:', curlResponse.substring(0, 200));
                data = JSON.parse(curlResponse);
                break;
            } catch (curlError) {
                console.log(`⚠️ Tentative ${attempt} echouee:`, curlError.message);
                if (attempt === 3) {
                    data = { status: 'error', message: 'Connexion echouee apres 3 tentatives' };
                }
            }
        }
        
        console.log('📨 AudD response:', data?.status);

        if (data?.status === 'success' && data?.result) {
            console.log(`✅ Reconnu: ${data.result.title} - ${data.result.artist}`);
            
            return res.json({
                status: 'success',
                result: {
                    title: data.result.title,
                    artist: data.result.artist,
                    album: data.result.album || 'Album inconnu',
                    link: data.result.song_link || '',
                    year: data.result.release_date || data.result.year || '',
                    label: data.result.label || '',
                    type: data.result.type || 'Music',
                    appleMusic: data.result?.apple_music?.url || '',
                    spotify: data.result?.spotify?.url || '',
                    deezer: data.result?.deezer?.url || '',
                    youtube: data.result?.youtube?.url || ''
                }
            });
        }

        return res.json({ status: 'error', message: data?.message || 'Audio non reconnu' });

    } catch (error) {
        console.error('❌ Erreur identification:', error.message || error.code || error);
        res.status(500).json({ status: 'error', message: 'Erreur lors de l\'analyse.' });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Serveur Shazam sur port ${PORT}`);
});