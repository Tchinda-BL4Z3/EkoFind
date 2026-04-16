require('dotenv').config();
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

const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN || "710700a1bebd7e387e268bf238669573";

const ACR_HOST = process.env.ACR_HOST || "identify-us-west-2.acrcloud.com";
const ACR_ACCESS_KEY = process.env.ACR_ACCESS_KEY || "";
const ACR_SECRET_KEY = process.env.ACR_SECRET_KEY || "";

async function recognizeWithACRCloud(filePath) {
    if (!ACR_ACCESS_KEY || !ACR_SECRET_KEY) {
        throw new Error("ACRCloud credentials not configured");
    }
    
    console.log('🎵 ACRCloud识别开始...');
    const timestamp = Math.floor(Date.now() / 1000);
    const sampleBytes = fs.statSync(filePath).size;
    console.log('📄 File size:', sampleBytes);
    
    const dataType = "audio";
    const signatureVersion = "1";
    
    const stringToSign = `POST\n/v1/identify\n${dataType}\n${signatureVersion}\n${ACR_SECRET_KEY}\n${timestamp}`;
    console.log('🔑 String to sign:', stringToSign.substring(0, 50));
    
    const signature = crypto.createHmac('sha1', ACR_SECRET_KEY)
        .update(stringToSign)
        .digest('base64');
    
    console.log('✅ Signature:', signature.substring(0, 20) + '...');
    
    const form = new FormData();
    form.append('api_key', ACR_ACCESS_KEY);
    form.append('sample', fs.createReadStream(filePath));
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('data_type', dataType);
    form.append('signature_version', signatureVersion);
    form.append('generate_song_payload', 'true');
    
    console.log('📤 Sending to ACRCloud...');
    const response = await axios.post(`https://${ACR_HOST}/v1/identify`, form, {
        headers: form.getHeaders(),
        timeout: 25000
    });
    
    console.log('📥 ACRCloud response:', JSON.stringify(response.data).substring(0, 200));
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

        const form = new FormData();
        form.append('api_token', AUDD_API_TOKEN);
        form.append('file', fs.createReadStream(filePath));
        form.append('return', 'apple_music,spotify');

        const response = await axios.post('https://api.audd.io/', form, {
            headers: form.getHeaders(),
            timeout: 20000 
        });

        const data = response.data;
        console.log('📨 Full AudD response:', JSON.stringify(data));
        
        if (data.status === 'success' && data.result) {
            console.log(`✅ Reconnu: ${data.result.title} - ${data.result.artist}`);
            res.json({
                status: "success",
                result: {
                    title: data.result.title,
                    artist: data.result.artist,
                    album: data.result.album || "Album inconnu",
                    link: data.result.song_link || ""
                }
            });
        } else if (data.error) {
            res.json({ status: "error", message: data.error.error_message || "Erreur API" });
        } else {
            res.json({ status: "error", message: "Musique non reconnue" });
        }

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
    
    if (!req.file) {
        console.log('❌ Pas de fichier audio');
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

        let data;
        if (ACR_ACCESS_KEY && ACR_SECRET_KEY) {
            console.log('⏳ Envoi vers ACRCloud...');
            data = await recognizeWithACRCloud(filePath);
            console.log('📨 Réponse ACRCloud:', data.status);
            
            if (data.status === 'success' && data.metadata && data.metadata.music) {
                const music = data.metadata.music[0];
                console.log(`✅ Reconnu: ${music.title} - ${music.artists?.[0]?.name}`);
                res.json({
                    status: 'success',
                    result: {
                        title: music.title,
                        artist: music.artists?.[0]?.name || 'Unknown Artist',
                        album: music.album?.name || 'Album inconnu',
                        link: music.external_links?.[0]?.url || ''
                    }
                });
            } else {
                res.json({ status: 'error', message: 'Musique non reconnue' });
            }
        } else {
            const form = new FormData();
            form.append('api_token', AUDD_API_TOKEN);
            form.append('file', fs.createReadStream(filePath));
            form.append('return', 'apple_music,spotify');

            console.log('⏳ Envoi vers API AudD...');
            const response = await axios.post('https://api.audd.io/', form, {
                headers: form.getHeaders(),
                timeout: 20000 
            });

            data = response.data;
            console.log('📨 Réponse API AudD:', data.status);
            
            if (data.status === 'success' && data.result) {
                console.log(`✅ Reconnu: ${data.result.title} - ${data.result.artist}`);
                res.json({
                    status: 'success',
                    result: {
                        title: data.result.title,
                        artist: data.result.artist,
                        album: data.result.album || 'Album inconnu',
                        link: data.result.song_link || ''
                    }
                });
            } else if (data.error) {
                res.json({ status: 'error', message: data.error.error_message || 'Erreur API' });
            } else {
                res.json({ status: 'error', message: 'Musique non reconnue' });
            }
        }

    } catch (error) {
        console.error('❌ Erreur identification:', error.message || error.code || error);
        if (error.response) {
            console.error('📨 API Response status:', error.response.status);
            console.error('📨 API Response data:', JSON.stringify(error.response.data).substring(0, 200));
        }
        if (error.code === 'ECONNREFUSED') {
            console.error('🔴 API inaccessible - vérifier la connexion');
            return res.status(503).json({ status: 'error', message: 'API inaccessible' });
        }
        if (error.code === 'ENOTFOUND') {
            console.error('🔴 API non trouvée - vérifier le DNS');
            return res.status(503).json({ status: 'error', message: 'API non trouvée' });
        }
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