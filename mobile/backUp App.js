import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Pressable, ActivityIndicator, Alert, Platform, Dimensions, Image, ScrollView, Animated } from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import axios from 'axios';

const { width } = Dimensions.get('window');

// CONFIGURATION THEME OBSIDIAN (Basé sur tes images)
const PRIMARY_COLOR = '#00E5FF'; 
const BG_COLOR = '#050505'; 
const CARD_BG = '#121212';
const TEXT_MAIN = '#FFFFFF';
const TEXT_SUB = '#888888';

export default function App() {
  const [activeTab, setActiveTab] = useState('SEARCH');
  const [recording, setRecording] = useState(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [result, setResult] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const scanAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Audio.requestPermissionsAsync();
    
    // Animation de scan pour la vidéo
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 3000, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 3000, useNativeDriver: true }),
      ])
    ).start();

    // Animation de pulsation pour le bouton Listen
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, [isRecording]);

  // --- LOGIQUE (Audio / Vidéo / Envoi) - GARDÉE INTACTE ---
  async function startRecording() {
    try {
      setResult(null);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: newRecording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) { Alert.alert("Erreur", "Microphone inaccessible"); }
  }

  async function stopRecording() {
    if (!recording) return;
    try {
      setIsRecording(false);
      setIsIdentifying(true);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      sendMediaToServer(uri, 'audio/m4a', 'recording.m4a');
    } catch (error) { console.error(error); }
  }

  async function pickVideo() {
    let resultPicker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      quality: 1,
    });
    if (!resultPicker.canceled) {
      setIsIdentifying(true);
      sendMediaToServer(resultPicker.assets[0].uri, 'video/mp4', 'video.mp4');
    }
  }

  async function sendMediaToServer(uri, type, name) {
    const formData = new FormData();
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      const blob = await response.blob();
      formData.append('audio', blob, name);
    } else {
      formData.append('audio', { uri, type, name });
    }
    try {
      const res = await axios.post(`http://localhost:3000/identify`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.status === 'success') setResult(res.data.result);
      else Alert.alert("Désolé", "Média non reconnu");
    } catch (error) {
      Alert.alert("Erreur", "Serveur injoignable");
    } finally {
      setIsIdentifying(false);
      setRecording(null);
    }
  }

  // --- RENDUS DES INTERFACES ---

  const renderHeader = () => (
    <View style={styles.header}>
      <Image source={{ uri: 'https://i.pravatar.cc/150?u=shazam' }} style={styles.avatar} />
      <Text style={styles.headerLogo}>OBSIDIAN PULSE</Text>
      <Ionicons name="settings-sharp" size={24} color={PRIMARY_COLOR} />
    </View>
  );

  const renderSearchContent = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContainer}>
      {/* Visualiseur Spectral */}
      <View style={styles.spectralContainer}>
        {[0.4, 0.7, 1, 0.5, 0.8, 0.4, 0.9, 0.6, 0.8, 0.5, 0.3].map((h, i) => (
          <View key={i} style={[styles.spectralBar, { height: h * 60, opacity: isRecording ? 1 : 0.3 }]} />
        ))}
      </View>
      <Text style={styles.spectralLabel}>REAL-TIME SPECTRAL ANALYSIS</Text>

      {/* Bouton Principal */}
      <View style={styles.centerSection}>
        <Animated.View style={[styles.pulseCircle, isRecording && { transform: [{ scale: pulseAnim }] }]} />
        <Pressable 
          style={styles.mainBeacon} 
          onPressIn={startRecording} 
          onPressOut={stopRecording}
        >
           {isIdentifying ? (
             <ActivityIndicator color="#000" />
           ) : (
             <View style={{alignItems: 'center'}}>
                <MaterialCommunityIcons name="waveform" size={50} color="#000" />
                <Text style={styles.beaconText}>{isRecording ? "LISTENING" : "LISTEN"}</Text>
             </View>
           )}
        </Pressable>
        <Text style={styles.heroTitle}>Identify Sound</Text>
        <Text style={styles.heroSub}>Tap the pulse to search for songs, podcasts, or cinematic audio samples.</Text>
      </View>

      {/* Match Card */}
      <View style={styles.matchCard}>
        <View>
          <Text style={styles.matchLabel}>RECENT MATCH</Text>
          <Text style={styles.matchTitle}>{result ? result.title : "Obsidian Echoes"}</Text>
          <Text style={styles.matchArtist}>{result ? result.artist : "Artist: Pulse Collective"}</Text>
        </View>
        <Image source={{ uri: 'https://picsum.photos/200' }} style={styles.matchImage} />
      </View>

      {/* Grille d'actions */}
      <View style={styles.actionGrid}>
        <View style={styles.actionItem}><Ionicons name="time-outline" size={24} color={PRIMARY_COLOR} /><Text style={styles.actionText}>HISTORY</Text></View>
        <View style={styles.actionItem}><MaterialCommunityIcons name="sparkles" size={24} color={PRIMARY_COLOR} /><Text style={styles.actionText}>IDENTIFY</Text></View>
      </View>
    </ScrollView>
  );

  const renderVideoContent = () => {
    const translateY = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 280] });
    return (
      <View style={styles.videoContent}>
        <View style={styles.viewfinder}>
          <View style={styles.cornerTL} /><View style={styles.cornerTR} /><View style={styles.cornerBL} /><View style={styles.cornerBR} />
          <View style={styles.camTopInfo}>
            <View style={styles.recPill}><View style={styles.recDot} /><Text style={styles.recText}>REC</Text></View>
            <Text style={styles.camRes}>4K 60FPS</Text>
          </View>
          <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
          <View style={styles.camControls}>
             <Pressable style={styles.camCircleBtn} onPress={pickVideo}><Ionicons name="images" size={24} color="#FFF" /><Text style={styles.camBtnText}>GALLERY</Text></Pressable>
             <Pressable style={styles.camMainBtn} onPress={pickVideo}><Ionicons name="scan" size={32} color="#000" /></Pressable>
             <Pressable style={styles.camCircleBtn}><Ionicons name="flashlight" size={24} color="#FFF" /><Text style={styles.camBtnText}>FLASH</Text></Pressable>
          </View>
        </View>
      </View>
    );
  };

  const renderPodcastContent = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContainer}>
      <View style={styles.searchBar}><Ionicons name="search" size={20} color={TEXT_SUB} /><Text style={styles.searchPlaceholder}>Search by episode title or guest...</Text></View>
      
      <View style={[styles.centerSection, {marginTop: 30}]}>
          <View style={styles.pPulseCircle} />
          <Pressable style={styles.pBeacon} onPressIn={startRecording} onPressOut={stopRecording}>
            <MaterialCommunityIcons name="waveform" size={40} color="#000" />
            <Text style={styles.pBeaconText}>LISTENING</Text>
          </Pressable>
          <Text style={styles.heroTitle}>Identify by Sound</Text>
          <Text style={styles.pSub}>HOLD NEAR SOURCE FOR INSTANT MATCH</Text>
      </View>

      <Text style={styles.sectionTitle}>TRENDING PODCASTS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
        {[1,2,3].map(i => (
          <View key={i} style={styles.podcastCard}>
             <Image source={{ uri: `https://picsum.photos/seed/${i+10}/300/400` }} style={styles.podcastImg} />
             <Text style={styles.pTitle}>The Quantum Loop</Text>
             <Text style={styles.pGenre}>SCIENCE & TECH</Text>
          </View>
        ))}
      </ScrollView>

      <Text style={styles.sectionTitle}>DISCOVER GENRES</Text>
      <View style={styles.genreGrid}>
        {['CRIME', 'TECH', 'COMEDY', 'MINDSET'].map(g => (
          <View key={g} style={styles.genreItem}>
            <Ionicons name="rocket-outline" size={24} color={PRIMARY_COLOR} />
            <Text style={styles.genreText}>{g}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      {activeTab === 'SEARCH' && renderSearchContent()}
      {activeTab === 'VIDEO' && renderVideoContent()}
      {activeTab === 'PODCAST' && renderPodcastContent()}

      {/* Navigation Bas */}
      <View style={styles.bottomNav}>
        <Pressable onPress={() => setActiveTab('SEARCH')} style={styles.navItem}>
          <View style={[styles.navIconContainer, activeTab === 'SEARCH' && styles.navActive]}>
            <MaterialCommunityIcons name="waveform" size={24} color={activeTab === 'SEARCH' ? "#000" : TEXT_SUB} />
            {activeTab === 'SEARCH' && <Text style={styles.navTextActive}>SEARCH</Text>}
          </View>
        </Pressable>
        <Pressable onPress={() => setActiveTab('VIDEO')} style={styles.navItem}>
          <View style={[styles.navIconContainer, activeTab === 'VIDEO' && styles.navActive]}>
            <MaterialCommunityIcons name="movie-play" size={24} color={activeTab === 'VIDEO' ? "#000" : TEXT_SUB} />
            {activeTab === 'VIDEO' && <Text style={styles.navTextActive}>VIDEO</Text>}
          </View>
        </Pressable>
        <Pressable onPress={() => setActiveTab('PODCAST')} style={styles.navItem}>
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
  scrollContainer: { paddingBottom: 120 },
  
  // SEARCH UI
  spectralContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', height: 100, marginTop: 20 },
  spectralBar: { width: 6, marginHorizontal: 3, backgroundColor: PRIMARY_COLOR, borderRadius: 3 },
  spectralLabel: { color: TEXT_SUB, textAlign: 'center', fontSize: 10, marginTop: 15, letterSpacing: 2 },
  centerSection: { alignItems: 'center', marginTop: 30 },
  pulseCircle: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0, 229, 255, 0.1)' },
  mainBeacon: { width: 160, height: 160, borderRadius: 80, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center' },
  beaconText: { fontWeight: 'bold', fontSize: 12, marginTop: 5 },
  heroTitle: { color: '#FFF', fontSize: 32, fontWeight: 'bold', marginTop: 20 },
  heroSub: { color: TEXT_SUB, textAlign: 'center', paddingHorizontal: 40, marginTop: 10, lineHeight: 20 },
  matchCard: { backgroundColor: CARD_BG, marginHorizontal: 20, marginTop: 40, borderRadius: 30, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  matchLabel: { color: PRIMARY_COLOR, fontSize: 10, fontWeight: 'bold', marginBottom: 5 },
  matchTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  matchArtist: { color: TEXT_SUB, fontSize: 14 },
  matchImage: { width: 60, height: 60, borderRadius: 15 },
  actionGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 20 },
  actionItem: { backgroundColor: CARD_BG, width: '48%', height: 100, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  actionText: { color: '#FFF', fontSize: 10, fontWeight: 'bold', marginTop: 10 },

  // VIDEO UI
  videoContent: { flex: 1, padding: 20 },
  viewfinder: { flex: 1, height: 500, backgroundColor: '#111', borderRadius: 40, overflow: 'hidden', borderWeight: 1, borderColor: 'rgba(0,229,255,0.2)' },
  camTopInfo: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 30 },
  recPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 15 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4B4B', marginRight: 6 },
  recText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  camRes: { color: PRIMARY_COLOR, fontSize: 10, fontWeight: 'bold' },
  scanLine: { width: '100%', height: 2, backgroundColor: PRIMARY_COLOR, position: 'absolute', top: 100 },
  camControls: { position: 'absolute', bottom: 40, width: '100%', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  camMainBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center', borderWidth: 5, borderColor: 'rgba(0,229,255,0.3)' },
  camCircleBtn: { alignItems: 'center' },
  camBtnText: { color: '#FFF', fontSize: 8, marginTop: 5, fontWeight: 'bold' },
  cornerTL: { position: 'absolute', top: 20, left: 20, width: 30, height: 30, borderTopWidth: 2, borderLeftWidth: 2, borderColor: PRIMARY_COLOR },
  cornerTR: { position: 'absolute', top: 20, right: 20, width: 30, height: 30, borderTopWidth: 2, borderRightWidth: 2, borderColor: PRIMARY_COLOR },
  cornerBL: { position: 'absolute', bottom: 150, left: 20, width: 30, height: 30, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: PRIMARY_COLOR },
  cornerBR: { position: 'absolute', bottom: 150, right: 20, width: 30, height: 30, borderBottomWidth: 2, borderRightWidth: 2, borderColor: PRIMARY_COLOR },

  // PODCAST UI
  searchBar: { flexDirection: 'row', backgroundColor: CARD_BG, marginHorizontal: 20, padding: 15, borderRadius: 20, alignItems: 'center' },
  searchPlaceholder: { color: TEXT_SUB, marginLeft: 10, fontSize: 12 },
  pPulseCircle: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0, 229, 255, 0.05)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.1)' },
  pBeacon: { width: 130, height: 130, borderRadius: 65, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center' },
  pBeaconText: { color: '#000', fontWeight: 'bold', fontSize: 10, marginTop: 5 },
  pSub: { color: PRIMARY_COLOR, fontSize: 10, fontWeight: 'bold', marginTop: 10, letterSpacing: 1 },
  sectionTitle: { color: '#FFF', fontWeight: 'bold', marginHorizontal: 20, marginTop: 40, marginBottom: 15 },
  horizontalScroll: { paddingLeft: 20 },
  podcastCard: { marginRight: 15, width: 160 },
  podcastImg: { width: 160, height: 200, borderRadius: 25 },
  pTitle: { color: '#FFF', fontWeight: 'bold', marginTop: 10, fontSize: 14 },
  pGenre: { color: TEXT_SUB, fontSize: 10, marginTop: 3 },
  genreGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20 },
  genreItem: { backgroundColor: CARD_BG, width: '48%', padding: 25, borderRadius: 25, marginBottom: 15, alignItems: 'center' },
  genreText: { color: '#FFF', fontWeight: 'bold', fontSize: 10, marginTop: 15 },

  // NAV BAR
  bottomNav: { position: 'absolute', bottom: 0, width: '100%', height: 100, backgroundColor: 'rgba(5,5,5,0.95)', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#111' },
  navItem: { flex: 1, alignItems: 'center' },
  navIconContainer: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 25, alignItems: 'center', flexDirection: 'row' },
  navActive: { backgroundColor: PRIMARY_COLOR, shadowColor: PRIMARY_COLOR, shadowRadius: 15, shadowOpacity: 0.5 },
  navTextActive: { color: '#000', fontWeight: 'bold', fontSize: 10, marginLeft: 8 }
});


// ==================================================================================================================

// import React, { useState, useEffect, useRef } from 'react';
// import { StyleSheet, Text, View, Pressable, ActivityIndicator, Alert, Platform, Dimensions } from 'react-native';
// import { Audio } from 'expo-av';
// import axios from 'axios';

// const SERVER_URL = 'http://localhost:3000';
// const MAX_RECORDING_DURATION = 10000;
// const BUTTON_SIZE = 180;

// export default function App() {
//   const [recording, setRecording] = useState(null);
//   const [isIdentifying, setIsIdentifying] = useState(false);
//   const [result, setResult] = useState(null);
//   const [isRecording, setIsRecording] = useState(false);
//   const [showLoading, setShowLoading] = useState(true);
//   const [loadingRotation, setLoadingRotation] = useState(0);
//   const [recordingProgress, setRecordingProgress] = useState(0);
//   const recordingTimeoutRef = useRef(null);
//   const progressIntervalRef = useRef(null);

//   useEffect(() => {
//     let rotation = 0;
//     const rotationInterval = setInterval(() => {
//       rotation = (rotation + 15) % 360;
//       setLoadingRotation(rotation);
//     }, 50);

//     const timer = setTimeout(() => {
//       clearInterval(rotationInterval);
//       setShowLoading(false);
//     }, 3000);

//     return () => {
//       clearInterval(rotationInterval);
//       clearTimeout(timer);
//     };
//   }, []);

//   useEffect(() => {
//     async function getPermission() {
//       const { status } = await Audio.requestPermissionsAsync();
//       if (status !== 'granted') {
//         Alert.alert("Permission requise", "L'accès au micro est nécessaire.");
//       }
//     }
//     getPermission();
    
//     return () => {
//       if (recordingTimeoutRef.current) {
//         clearTimeout(recordingTimeoutRef.current);
//       }
//       if (progressIntervalRef.current) {
//         clearInterval(progressIntervalRef.current);
//       }
//     };
//   }, []);

//   useEffect(() => {
//     if (isRecording) {
//       const startTime = Date.now();
      
//       progressIntervalRef.current = setInterval(() => {
//         const elapsed = Date.now() - startTime;
//         const progress = Math.min((elapsed / MAX_RECORDING_DURATION) * 100, 100);
//         setRecordingProgress(progress);
        
//         if (progress >= 100) {
//           clearInterval(progressIntervalRef.current);
//           stopRecording();
//         }
//       }, 50);

//       recordingTimeoutRef.current = setTimeout(async () => {
//         await stopRecording();
//       }, MAX_RECORDING_DURATION);
//     } else {
//       setRecordingProgress(0);
//       if (progressIntervalRef.current) {
//         clearInterval(progressIntervalRef.current);
//       }
//     }
    
//     return () => {
//       if (progressIntervalRef.current) {
//         clearInterval(progressIntervalRef.current);
//       }
//     };
//   }, [isRecording]);

//   async function startRecording() {
//     try {
//       setResult(null);
//       await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

//       const { recording: newRecording } = await Audio.Recording.createAsync(
//         Audio.RecordingOptionsPresets.HIGH_QUALITY
//       );
//       setRecording(newRecording);
//       setIsRecording(true);
      
//     } catch (err) {
//       console.error(err);
//       Alert.alert("Erreur", "Erreur microphone");
//     }
//   }

//   async function stopRecording() {
//     if (!recording) return;

//     if (recordingTimeoutRef.current) {
//       clearTimeout(recordingTimeoutRef.current);
//       recordingTimeoutRef.current = null;
//     }

//     try {
//       setIsRecording(false);
//       setIsIdentifying(true);
//       await recording.stopAndUnloadAsync();
//       const uri = recording.getURI(); 
//       setRecording(null);

//       const formData = new FormData();
//       if (Platform.OS === 'web') {
//         const response = await fetch(uri);
//         const blob = await response.blob();
//         formData.append('audio', blob, 'recording.wav');
//       } else {
//         formData.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' });
//       }

//       const res = await axios.post(`${SERVER_URL}/stop-recording`, formData);
//       if (res.data.status === 'success') {
//         setResult(res.data.result);
//       } else {
//         Alert.alert("Non reconnu", res.data.message || "Musique non reconnue");
//       }
//     } catch (error) {
//       Alert.alert("Erreur", "Erreur d'identification");
//     } finally {
//       setIsIdentifying(false);
//     }
//   }

//   function handlePressIn() {
//     startRecording();
//   }

//   function handlePressOut() {
//     stopRecording();
//   }

//   const fillDegrees = (recordingProgress / 100) * 360;

//   if (showLoading) {
//     return (
//       <View style={styles.loadingContainer}>
//         <View style={styles.loadingCircleContainer}>
//           <View style={[styles.loadingCircle, { transform: [{ rotate: `${loadingRotation}deg` }] }]} />
//           <Text style={styles.loadingEmoji}>🎵</Text>
//         </View>
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>Shazam-Clone</Text>
      
//       {result ? (
//         <View style={styles.resultCard}>
//           <Text style={styles.songTitle}>{result.title}</Text>
//           <Text style={styles.artistName}>{result.artist}</Text>
//           <Pressable onPress={() => setResult(null)} style={styles.backButton}>
//             <Text style={{color: 'white'}}>Réessayer</Text>
//           </Pressable>
//         </View>
//       ) : (
//         <View style={styles.buttonWrapper}>
//           <View style={styles.circleContainer}>
//             <View style={styles.circleBackground} />
//             {isRecording && (
//               <View style={[styles.circleFill, { 
//                 transform: [{ rotate: `${fillDegrees}deg` }]
//               }]} />
//             )}
//             <Pressable 
//               style={[styles.shazamButton, isRecording && styles.shazamButtonActive]} 
//               onPressIn={handlePressIn}
//               onPressOut={handlePressOut}
//               disabled={isIdentifying}
//             >
//               {isIdentifying ? (
//                 <ActivityIndicator size="large" color="#FFF" />
//               ) : (
//                 <Text style={styles.buttonText}>
//                   {isRecording ? "Écoute..." : "Maintenez"}
//                 </Text>
//               )}
//             </Pressable>
//           </View>
//         </View>
//       )}
//       <Text style={styles.footer}>{isRecording ? "Relâchez pour identifier" : "Maintenez pour identifier"}</Text>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   loadingContainer: {
//     flex: 1,
//     backgroundColor: '#080808',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   loadingCircleContainer: {
//     width: 100,
//     height: 100,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   loadingCircle: {
//     position: 'absolute',
//     width: 100,
//     height: 100,
//     borderRadius: 50,
//     borderWidth: 4,
//     borderColor: '#0055FF',
//     borderTopColor: 'transparent',
//     borderRightColor: 'transparent',
//   },
//   loadingEmoji: { fontSize: 50 },
//   container: {
//     flex: 1,
//     backgroundColor: '#080808',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   title: { color: 'white', fontSize: 24, fontWeight: 'bold', marginBottom: 40 },
//   buttonWrapper: { alignItems: 'center', justifyContent: 'center' },
//   circleContainer: {
//     width: BUTTON_SIZE,
//     height: BUTTON_SIZE,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   circleBackground: {
//     position: 'absolute',
//     width: BUTTON_SIZE,
//     height: BUTTON_SIZE,
//     borderRadius: BUTTON_SIZE / 2,
//     borderWidth: 4,
//     borderColor: '#333',
//   },
//   circleFill: {
//     position: 'absolute',
//     width: BUTTON_SIZE,
//     height: BUTTON_SIZE,
//     borderRadius: BUTTON_SIZE / 2,
//     borderWidth: 4,
//     borderColor: '#0055FF',
//     borderTopColor: 'transparent',
//   },
//   shazamButton: {
//     width: BUTTON_SIZE - 20,
//     height: BUTTON_SIZE - 20,
//     borderRadius: (BUTTON_SIZE - 20) / 2,
//     backgroundColor: '#0055FF',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   shazamButtonActive: { backgroundColor: '#FF0055' },
//   buttonText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
//   footer: { color: '#666', marginTop: 40 },
//   resultCard: { alignItems: 'center', padding: 30, backgroundColor: '#111', borderRadius: 20 },
//   songTitle: { color: 'white', fontSize: 26, fontWeight: 'bold' },
//   artistName: { color: '#0055FF', fontSize: 20, marginTop: 10 },
//   backButton: { marginTop: 30, padding: 15, backgroundColor: '#333', borderRadius: 10 }
// });
