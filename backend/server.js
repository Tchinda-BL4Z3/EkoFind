require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const app = express(); 
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const uploadDir = 'upload';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir + '/', limits: { fileSize: 25 * 1024 * 1024 } });

const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN || "710700a1bebd7e387e268bf238669573";

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

        const form = new FormData();
        form.append('api_token', AUDD_API_TOKEN);
        form.append('file', fs.createReadStream(filePath));
        form.append('return', 'apple_music,spotify');

        console.log('⏳ Envoi vers API AudD...');
        const response = await axios.post('https://api.audd.io/', form, {
            headers: form.getHeaders(),
            timeout: 20000 
        });

        const data = response.data;
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

    } catch (error) {
        console.error('❌ Erreur identification:', error.message || error.code || error);
        if (error.response) {
            console.error('📨 API Response status:', error.response.status);
            console.error('📨 API Response data:', JSON.stringify(error.response.data).substring(0, 200));
        }
        if (error.code === 'ECONNREFUSED') {
            console.error('🔴 API AudD inaccessible - vérifier la connexion');
            return res.status(503).json({ status: 'error', message: 'API inaccessible' });
        }
        if (error.code === 'ENOTFOUND') {
            console.error('🔴 API AudD non trouvée - vérifier le DNS');
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