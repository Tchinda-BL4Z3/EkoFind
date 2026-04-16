import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, Pressable, Dimensions, Image, ScrollView, Platform, Alert, PermissionsAndroid } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { CameraView, requestCameraPermissionsAsync } from 'expo-camera';

const { width } = Dimensions.get('window');

const SERVER_URL = 'http://192.168.100.227:3000';
const PRIMARY_COLOR = '#00E5FF'; 
const BG_COLOR = '#050505'; 
const CARD_BG = '#121212';
const TEXT_MAIN = '#FFFFFF';
const TEXT_SUB = '#888888';

const MAX_RECORDING_DURATION = 15000;

export default function App() {
  const [activeTab, setActiveTab] = useState('SEARCH');
  const [result, setResult] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [spectralHeights, setSpectralHeights] = useState([0.4, 0.7, 1, 0.5, 0.8, 0.4, 0.9, 0.6, 0.8, 0.5, 0.3]);
  
  const [pulseScale, setPulseScale] = useState(1);
  const recordingRef = useRef(null);
  const timerRef = useRef(null);
  const isRecordingRef = useRef(false);
  const activeTabRef = useRef('SEARCH');
  const [cameraPermission, setCameraPermission] = useState(null);
  const [isCamRecording, setIsCamRecording] = useState(false);
  const cameraRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    let pulseTimer;
    if (activeTab === 'SEARCH') {
      pulseTimer = setInterval(() => {
        setPulseScale(prev => prev === 1 ? 1.15 : 1);
      }, 1000);
    }
    return () => pulseTimer && clearInterval(pulseTimer);
  }, [activeTab]);

  useEffect(() => {
    let spectralTimer;
    if (isRecording) {
      spectralTimer = setInterval(() => {
        setSpectralHeights(prev => prev.map(() => Math.random()));
      }, 100);
    }
    return () => spectralTimer && clearInterval(spectralTimer);
  }, [isRecording]);

  useEffect(() => {
    (async () => {
      // Let Camera component handle permissions internally
      setCameraPermission(true);
    })();
  }, []);

  const requestPermissions = async () => {
    try {
      if (Audio.requestPermissionsAsync) {
        const { status } = await Audio.requestPermissionsAsync();
        console.log('Audio permission status:', status);
        return status === 'granted';
      }
    } catch (err) {
      console.warn('Permission request error:', err);
    }
    
    if (Platform.OS === 'android') {
      try {
        const grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        return grants[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err2) {
        console.warn(err2);
      }
    }
    return true;
  };

  const webMediaRecorderRef = useRef(null);
  const webChunksRef = useRef([]);
  const expoRecordingRef = useRef(null);
  const [recordingStatus, setRecordingStatus] = useState('ready');

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    
    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      Alert.alert('Permission denied', 'Microphone permission is required');
      return;
    }

    const isPodcast = activeTabRef.current === 'PODCAST';

    try {
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingTime(0);
      
      if (isPodcast) {
        setPodcastRecordingStatus('recording');
      } else {
        setRecordingStatus('recording');
      }

      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        webChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            webChunksRef.current.push(e.data);
          }
        };
        recorder.onstop = async () => {
          const blob = new Blob(webChunksRef.current, { type: 'audio/webm' });
          const file = new File([blob], 'recording.webm');
          if (isPodcast) {
            setPodcastRecordingStatus('processing');
          } else {
            setRecordingStatus('processing');
          }
          await sendAudioToServer(file, isPodcast);
          if (isPodcast) {
            setPodcastRecordingStatus('ready');
          } else {
            setRecordingStatus('ready');
          }
        };
        recorder.start();
        webMediaRecorderRef.current = recorder;
      } else {
        try {
          if (expoRecordingRef.current) {
            await expoRecordingRef.current.stopAndUnloadAsync();
          }
          
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
          });
          
          const recording = new Audio.Recording();
          await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          await recording.startAsync();
          expoRecordingRef.current = recording;
          console.log('=== Recording started ===');
        } catch (audioError) {
          console.error('Audio init error:', audioError);
          if (isPodcast) {
            setPodcastRecordingStatus('error');
          } else {
            setRecordingStatus('error');
          }
        }
      }

      timerRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_DURATION);

    } catch (error) {
      console.error('Start recording error:', error);
      if (isPodcast) {
        setPodcastRecordingStatus('error');
      } else {
        setRecordingStatus('error');
      }
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  };

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;

    const isPodcast = activeTabRef.current === 'PODCAST';
    let audioUri = null;

    try {
      isRecordingRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (Platform.OS === 'web' && webMediaRecorderRef.current) {
        webMediaRecorderRef.current.stop();
        webMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
} else if (expoRecordingRef.current) {
        if (isPodcast) {
          setPodcastRecordingStatus('processing');
        } else {
          setRecordingStatus('processing');
        }
        
        const recording = expoRecordingRef.current;
        try {
          await recording.stopAndUnloadAsync();
          audioUri = recording.getURI();
        } catch (stopError) {
          console.warn('Stop warning:', stopError.message);
          try {
            audioUri = recording.getURI();
          } catch (e) {}
        }
        console.log('=== URI AFTER stop:', audioUri);
        
        expoRecordingRef.current = null;
        
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      }
    } catch (error) {
      console.error('Stop recording error:', error);
      if (isPodcast) {
        setPodcastRecordingStatus('error');
      } else {
        setRecordingStatus('error');
      }
    } finally {
      setIsRecording(false);
    }

    if (audioUri) {
      await sendAudioToServer(audioUri, isPodcast);
    }
  }, []);

  const sendAudioToServer = async (audioFile, isPodcast = false) => {
    console.log('=== sendAudioToServer called ===');
    console.log('audioFile:', audioFile);
    console.log('isPodcast:', isPodcast);
    
    if (!audioFile) {
      console.warn('No audio file to send');
      if (isPodcast) setPodcastRecordingStatus('error');
      else setRecordingStatus('error');
      return;
    }
    
    if (isPodcast) {
      setPodcastRecordingStatus('processing');
    } else {
      setRecordingStatus('processing');
    }
    
    console.log('Sending audio to server...');
    
    const formData = new FormData();
    if (Platform.OS === 'web') {
      formData.append('audio', audioFile, 'recording.webm');
    } else {
      formData.append('audio', {
        uri: String(audioFile),
        type: 'audio/m4a',
        name: 'recording.m4a'
      });
    }
    
    console.log('Server URL:', SERVER_URL);
    
    try {
      const res = await fetch(`${SERVER_URL}/identify`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      console.log('Server response:', data);
      
      if (data.status === 'success' && data.result) {
        setResult(data.result);
      } else {
        setResult({ 
          title: data.result?.title || 'Not Found', 
          artist: data.result?.artist || data.message || 'Try again with clearer audio',
          link: data.result?.link || ''
        });
      }
    } catch (error) {
      console.error('Send to server error:', error);
      if (isPodcast) {
        setPodcastRecordingStatus('error');
      } else {
        setRecordingStatus('error');
      }
      setResult({ title: 'Connection Error', artist: 'Check server and try again' });
    } finally {
      if (isPodcast) {
        setPodcastRecordingStatus('ready');
      } else {
        setRecordingStatus('ready');
      }
    }
  };

  async function pickVideo() {
    let resultPicker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      quality: 1,
    });
    if (!resultPicker.canceled) {
      sendMediaToServer(resultPicker.assets[0].uri, 'video/mp4', 'video.mp4');
    }
  }

  async function sendMediaToServer(uri, type, name) {
    if (!uri) return;
    const formData = new FormData();
    formData.append('audio', { uri, type, name });
    try {
      console.log('Sending video to server...');
      const res = await fetch(`${SERVER_URL}/identify`, { method: 'POST', body: formData });
      const data = await res.json();
      console.log('Video server response:', data);
      if (data.status === 'success') setResult(data.result);
      else setResult({ title: 'Not Found', artist: data.message || 'Try again' });
    } catch (error) { 
      console.error('Video send error:', error);
      setResult({ title: 'Error', artist: error.message });
    }
  }

  const renderSearchContent = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <View style={styles.spectralContainer}>
        {spectralHeights.map((h, i) => (
          <View key={i} style={[styles.spectralBar, { height: h * 50, opacity: isRecording ? 1 : 0.4 }]} />
        ))}
      </View>
      <Text style={styles.spectralLabel}>REAL-TIME SPECTRAL ANALYSIS {isRecording && `• ${Math.min(recordingTime, 15)}s`}</Text>

      <View style={styles.centerSection}>
        <View style={[styles.pulseCircle, { transform: [{ scale: pulseScale }] }]} />
        <Pressable 
          style={[
            styles.mainBeacon,
            recordingStatus === 'processing' && styles.mainBeaconProcessing,
            recordingStatus === 'error' && styles.mainBeaconError
          ]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
          disabled={recordingStatus === 'processing'}
        >
          <MaterialCommunityIcons name={
            recordingStatus === 'processing' ? 'loading' : 
            recordingStatus === 'error' ? 'alert-circle' : 'headphones'
          } size={50} color="#000" />
          <Text style={styles.beaconText}>
            {recordingStatus === 'processing' ? 'SEARCHING...' : 
             recordingStatus === 'error' ? 'ERROR' :
             isRecording ? "LISTENING" : "LISTEN"}
          </Text>
          {isRecording && <Text style={styles.beaconTime}>{recordingTime}s / 15s</Text>}
        </Pressable>
        <Text style={styles.heroTitle}>Identify Sound</Text>
        <Text style={styles.heroSub}>Hold to search for songs, podcasts, or cinematic audio samples.</Text>
      </View>

      <View style={styles.matchCard}>
        <View><Text style={styles.matchLabel}>RECENT MATCH</Text>
        <Text style={styles.matchTitle}>{result ? result.title : "Audio Echoes"}</Text>
        <Text style={styles.matchArtist}>{result ? result.artist : "Artist: Pulse Collective"}</Text>
        </View>
        <Image source={{ uri: result?.image || 'https://picsum.photos/200' }} style={styles.matchImage} />
      </View>

      <View style={styles.actionGrid}>
        <View style={styles.actionItem}><Ionicons name="time-outline" size={24} color={PRIMARY_COLOR} /><Text style={styles.actionText}>HISTORY</Text></View>
        <View style={styles.actionItem}><Ionicons name="musical-notes" size={24} color={PRIMARY_COLOR} /><Text style={styles.actionText}>IDENTIFY</Text></View>
      </View>
    </ScrollView>
);

  const startVideoRecording = async () => {
    if (!cameraRef.current) {
      Alert.alert('Camera not ready');
      return;
    }
    try {
      setIsCamRecording(true);
      // Start recording - returns a promise
      const video = await cameraRef.current.recordAsync();
      console.log('Video result:', video);
      if (video && video.uri) {
        console.log('Video recorded:', video.uri);
        sendMediaToServer(video.uri, 'video/mp4', 'video.mp4');
      }
    } catch (error) {
      console.error('Video error:', error);
      setIsCamRecording(false);
    }
  };

  const stopVideoRecording = () => {
    if (cameraRef.current && isCamRecording) {
      try {
        cameraRef.current.stopRecording();
        setIsCamRecording(false);
        console.log('Recording stopped');
      } catch (e) {
        console.error('Stop error:', e);
        setIsCamRecording(false);
      }
    }
  };

  const renderVideoContent = () => (
    <View style={styles.videoContainer}>
      <View style={styles.camSection}>
        <View style={styles.camFrame}>
{cameraPermission && CameraView ? (
            <CameraView
              ref={cameraRef}
              style={styles.cam}
            />
          ) : (
            <View style={styles.camPlaceholder}>
              <Ionicons name="videocam" size={50} color={PRIMARY_COLOR} />
              <Text style={styles.camPlaceholderText}>CAMERA NOT AVAILABLE</Text>
              <Text style={styles.camPlaceholderSub}>Check permissions</Text>
            </View>
          )}
          <View style={styles.camOverlay}>
            <View style={styles.camTopInfo}>
              <View style={styles.recBadge}>
                <View style={[styles.recDot, isCamRecording && styles.recDotActive]} />
                <Text style={styles.recText}>{isCamRecording ? 'RECORDING' : 'STANDBY'}</Text>
              </View>
            </View>
            <View style={styles.cornerTL} />
            <View style={styles.cornerTR} />
            <View style={styles.cornerBL} />
            <View style={styles.cornerBR} />
          </View>
        </View>
      </View>
      
      <View style={styles.camControls2}>
        <View style={styles.camBtnItem}>
          <Pressable style={styles.camCircleBtn} onPress={pickVideo}>
            <Ionicons name="images" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.camBtnText}>GALLERY</Text>
        </View>
        <View style={styles.camBtnItem}>
          <Pressable 
            style={[styles.camMainBtn, isCamRecording && styles.camMainBtnRecording]}
            onPressIn={() => {
              setIsCamRecording(true);
              startVideoRecording();
            }}
            onPressOut={() => {
              setIsCamRecording(false);
              stopVideoRecording();
            }}
          >
            <Ionicons name="videocam" size={32} color="#000" />
          </Pressable>
        </View>
        <View style={styles.camBtnItem}>
          <Pressable style={styles.camCircleBtn}>
            <Ionicons name="flashlight" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.camBtnText}>FLASH</Text>
        </View>
      </View>
    </View>
  );

  const [podcastPulseScale, setPodcastPulseScale] = useState(1);
  const [podcastRecordingStatus, setPodcastRecordingStatus] = useState('ready');
  const [podcastSpectralHeights, setPodcastSpectralHeights] = useState([0.3, 0.6, 0.9, 0.5, 0.8, 0.4, 0.7, 0.5, 0.9, 0.6]);

  useEffect(() => {
    let podcastPulseTimer;
    if (activeTab === 'PODCAST') {
      podcastPulseTimer = setInterval(() => {
        setPodcastPulseScale(prev => prev === 1 ? 1.15 : 1);
      }, 1200);
    }
    return () => podcastPulseTimer && clearInterval(podcastPulseTimer);
  }, [activeTab]);

  useEffect(() => {
    let podcastSpectralTimer;
    if (isRecording && activeTab === 'PODCAST') {
      podcastSpectralTimer = setInterval(() => {
        setPodcastSpectralHeights(prev => prev.map(() => Math.random()));
      }, 80);
    }
    return () => podcastSpectralTimer && clearInterval(podcastSpectralTimer);
  }, [isRecording, activeTab]);

  const renderPodcastContent = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <View style={styles.searchBar}><Ionicons name="search" size={20} color={TEXT_SUB} /><Text style={styles.searchPlaceholder}>Search episodes...</Text></View>
      <View style={styles.pHero}><Text style={styles.pHeroTitle}>Hear something?</Text></View>
      
      <View style={styles.pBeaconContainer}>
        <View style={[styles.pPulseCircle, { transform: [{ scale: podcastPulseScale }] }]} />
        <Pressable 
          style={[
            styles.pBeacon,
            podcastRecordingStatus === 'processing' && styles.pBeaconProcessing,
            podcastRecordingStatus === 'error' && styles.pBeaconError
          ]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
          disabled={podcastRecordingStatus === 'processing'}
        >
          <MaterialCommunityIcons name={
            podcastRecordingStatus === 'processing' ? 'loading' : 
            podcastRecordingStatus === 'error' ? 'alert-circle' : 'waveform'
          } size={32} color="#000" />
          <Text style={styles.pBeaconText}>
            {podcastRecordingStatus === 'processing' ? 'SEARCHING' : 
             podcastRecordingStatus === 'error' ? 'ERROR' :
             isRecording ? "LISTENING" : "IDENTIFY"}
          </Text>
          {isRecording && <Text style={styles.pBeaconTime}>{recordingTime}s / 15s</Text>}
        </Pressable>
      </View>

      <View style={styles.podcastSpectralContainer}>
        {podcastSpectralHeights.map((h, i) => (
          <View key={i} style={[styles.podcastSpectralBar, { height: h * 40, opacity: isRecording ? 1 : 0.3 }]} />
        ))}
      </View>
      <Text style={styles.podcastSpectralLabel}>
        {podcastRecordingStatus === 'processing' ? 'PROCESSING...' : 
         isRecording ? `RECORDING ${recordingTime}s` : 'HOLD TO IDENTIFY'}
      </Text>
      
      <Text style={styles.sectionTitle}>TRENDING PODCASTS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
        {[1,2,3].map(i => (<View key={i} style={styles.podcastCard}><Image source={{ uri: `https://picsum.photos/seed/${i+10}/300/400` }} style={styles.podcastImg} /><Text style={styles.pTitle}>The Quantum Loop</Text><Text style={styles.pGenre}>SCIENCE & TECH</Text></View>))}
      </ScrollView>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('./assets/logo.png')} style={styles.avatar} />
        <Text style={styles.headerLogo}>EKOFIND Pulse</Text>
        <Ionicons name="settings-sharp" size={24} color={activeTab === 'SETTINGS' ? PRIMARY_COLOR : TEXT_SUB} />
      </View>
      
      {activeTab === 'SEARCH' && renderSearchContent()}
      {activeTab === 'VIDEO' && renderVideoContent()}
      {activeTab === 'PODCAST' && renderPodcastContent()}

      <View style={styles.bottomNav}>
        <Pressable onPress={() => { setActiveTab('SEARCH'); activeTabRef.current = 'SEARCH'; }} style={styles.navItem}>
          <View style={[styles.navIconContainer, activeTab === 'SEARCH' && styles.navActive]}>
            <MaterialCommunityIcons name="waveform" size={24} color={activeTab === 'SEARCH' ? "#000" : TEXT_SUB} />
            {activeTab === 'SEARCH' && <Text style={styles.navTextActive}>SEARCH</Text>}
          </View>
        </Pressable>
        <Pressable onPress={() => { setActiveTab('VIDEO'); activeTabRef.current = 'VIDEO'; }} style={styles.navItem}>
          <View style={[styles.navIconContainer, activeTab === 'VIDEO' && styles.navActive]}>
            <MaterialCommunityIcons name="movie-play" size={24} color={activeTab === 'VIDEO' ? "#000" : TEXT_SUB} />
            {activeTab === 'VIDEO' && <Text style={styles.navTextActive}>VIDEO</Text>}
          </View>
        </Pressable>
        <Pressable onPress={() => { setActiveTab('PODCAST'); activeTabRef.current = 'PODCAST'; }} style={styles.navItem}>
          <View style={[styles.navIconContainer, activeTab === 'PODCAST' && styles.navActive]}>
            <MaterialCommunityIcons name="podcast" size={24} color={activeTab === 'PODCAST' ? "#000" : TEXT_SUB} />
            {activeTab === 'PODCAST' && <Text style={styles.navTextActive}>PODCASTS</Text>}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG_COLOR },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 20 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: PRIMARY_COLOR },
  headerLogo: { color: PRIMARY_COLOR, fontWeight: 'bold', fontSize: 18, letterSpacing: 1 },
  scrollContent: { paddingBottom: 120 },
  
  spectralContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', height: 80, marginTop: 20 },
  spectralBar: { width: 6, marginHorizontal: 3, backgroundColor: PRIMARY_COLOR, borderRadius: 3 },
  spectralLabel: { color: TEXT_SUB, textAlign: 'center', fontSize: 10, marginTop: 10, letterSpacing: 2 },
  
  centerSection: { alignItems: 'center', marginTop: 30, position: 'relative' },
  pulseCircle: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0, 229, 255, 0.1)' },
  mainBeacon: { width: 160, height: 160, borderRadius: 80, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center' },
  mainBeaconProcessing: { backgroundColor: '#FFA500' },
  mainBeaconError: { backgroundColor: '#FF4444' },
  beaconText: { fontWeight: 'bold', fontSize: 12, marginTop: 5 },
  beaconTime: { fontSize: 10, color: '#000', marginTop: 3 },
  heroTitle: { color: TEXT_MAIN, fontSize: 32, fontWeight: 'bold', marginTop: 20 },
  heroSub: { color: TEXT_SUB, textAlign: 'center', paddingHorizontal: 40, marginTop: 10, lineHeight: 20 },
  
  matchCard: { backgroundColor: CARD_BG, marginHorizontal: 20, marginTop: 40, borderRadius: 30, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  matchLabel: { color: PRIMARY_COLOR, fontSize: 10, fontWeight: 'bold', marginBottom: 5 },
  matchTitle: { color: TEXT_MAIN, fontSize: 18, fontWeight: 'bold' },
  matchArtist: { color: TEXT_SUB, fontSize: 14 },
  matchImage: { width: 60, height: 60, borderRadius: 15 },
  
  actionGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 20 },
  actionItem: { backgroundColor: CARD_BG, width: '48%', height: 100, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  actionText: { color: TEXT_MAIN, fontSize: 10, fontWeight: 'bold', marginTop: 10 },

  videoContainer: { flex: 1, backgroundColor: BG_COLOR },
  camSection: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
  camFrame: { width: width * 0.9, height: width * 0.9 * 1.3, borderRadius: 25, backgroundColor: '#111', position: 'relative', overflow: 'hidden' },
  cam: { flex: 1, borderRadius: 25 },
  camPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  recDotActive: { backgroundColor: '#FF0000' },
  camMainBtnRecording: { backgroundColor: '#FF4444' },
  camPlaceholderText: { color: TEXT_MAIN, fontSize: 18, fontWeight: 'bold', marginTop: 15 },
  camPlaceholderSub: { color: TEXT_SUB, fontSize: 12, marginTop: 8 },
  camOverlay: { ...StyleSheet.absoluteFillObject },
  camTopInfo: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 15 },
  recBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#888', marginRight: 6 },
  recText: { color: TEXT_MAIN, fontSize: 10, fontWeight: 'bold' },
  cornerTL: { position: 'absolute', top: 12, left: 12, width: 30, height: 30, borderTopWidth: 2, borderLeftWidth: 2, borderColor: PRIMARY_COLOR },
  cornerTR: { position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderTopWidth: 2, borderRightWidth: 2, borderColor: PRIMARY_COLOR },
  cornerBL: { position: 'absolute', bottom: 12, left: 12, width: 30, height: 30, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: PRIMARY_COLOR },
  cornerBR: { position: 'absolute', bottom: 12, right: 12, width: 30, height: 30, borderBottomWidth: 2, borderRightWidth: 2, borderColor: PRIMARY_COLOR },
  camControls2: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 20, paddingBottom: 100 },
  camBtnItem: { alignItems: 'center' },
  camCircleBtn: { width: 55, height: 55, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  camMainBtn: { width: 75, height: 75, borderRadius: 37, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: 'rgba(0,229,255,0.3)' },
  camBtnText: { color: TEXT_MAIN, fontSize: 9, marginTop: 6, fontWeight: 'bold' },

  searchBar: { flexDirection: 'row', backgroundColor: CARD_BG, marginHorizontal: 20, padding: 15, borderRadius: 20, alignItems: 'center', marginTop: 10 },
  searchPlaceholder: { color: TEXT_SUB, marginLeft: 10, fontSize: 12 },
  pHero: { alignItems: 'center', marginTop: 30 },
  pHeroTitle: { fontSize: 28, fontWeight: 'bold', color: TEXT_MAIN },
  pBeaconContainer: { height: 200, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  pPulseCircle: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0, 229, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.1)' },
  pBeacon: { width: 120, height: 120, borderRadius: 60, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center' },
  pBeaconProcessing: { backgroundColor: '#FFA500' },
  pBeaconError: { backgroundColor: '#FF4444' },
  pBeaconText: { color: TEXT_MAIN, fontSize: 10, fontWeight: 'bold', marginTop: 5 },
  pBeaconTime: { fontSize: 8, color: '#000', marginTop: 2 },
  sectionTitle: { color: TEXT_MAIN, fontWeight: 'bold', marginHorizontal: 20, marginTop: 40, marginBottom: 15 },
  horizontalScroll: { paddingLeft: 20 },
  podcastCard: { marginRight: 15, width: 160 },
  podcastImg: { width: 160, height: 200, borderRadius: 25 },
  pTitle: { color: TEXT_MAIN, fontWeight: 'bold', marginTop: 10, fontSize: 14 },
  pGenre: { color: TEXT_SUB, fontSize: 10, marginTop: 3 },
  podcastSpectralContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', height: 50, marginTop: 15 },
  podcastSpectralBar: { width: 5, marginHorizontal: 2, backgroundColor: PRIMARY_COLOR, borderRadius: 2 },
  podcastSpectralLabel: { color: TEXT_SUB, textAlign: 'center', fontSize: 9, marginTop: 8, letterSpacing: 1 },

  bottomNav: { position: 'absolute', bottom: 0, width: '100%', height: 100, backgroundColor: CARD_BG, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#111', paddingBottom: 20 },
  navItem: { flex: 1, alignItems: 'center' },
  navIconContainer: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 25, alignItems: 'center', flexDirection: 'row' },
  navActive: { backgroundColor: PRIMARY_COLOR },
  navTextActive: { color: '#000', fontWeight: 'bold', fontSize: 10, marginLeft: 8 },
});
