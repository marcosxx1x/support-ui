'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// --- Configuration Constants ---
const SILENCE_THRESHOLD = 2;
const ACTIVITY_DECAY = 0.01;
const MIN_SILENCE_DURATION_TO_PAUSE = 2000;
const MAX_SILENCE_DURATION_TO_DISCONNECT = 5000;
const MIN_ACTIVITY_DURATION = 50;
const ACTIVITY_HISTORY_SIZE = 10;

export default function VoiceAssistant() {
    // --- State Management ---
    const [appState, setAppState] = useState<'idle' | 'active'>('idle');
    const [statusMessage, setStatusMessage] = useState('Click the microphone to begin');
    const [sttStatusMessage, setSttStatusMessage] = useState('');
    const [isListening, setIsListening] = useState(false);
    
    // --- Refs for non-state variables and DOM elements ---
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const websocket = useRef<WebSocket | null>(null);
    const audioContext = useRef<AudioContext | null>(null);
    const analyser = useRef<AnalyserNode | null>(null);
    const microphoneStream = useRef<MediaStream | null>(null);
    const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
    const animationFrameId = useRef<number | null>(null);
    
    const isRecording = useRef(false);
    const isVoiceActive = useRef(false);
    const silenceStart = useRef(0);
    const activityLevel = useRef(0);
    const activityHistory = useRef<number[]>([]);
    const recordingStartTime = useRef(0);
    const logCounter = useRef(0);

    const drawDefaultCanvasState = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#636e72';
        ctx.textAlign = 'center';
        ctx.font = `${Math.min(20, canvas.width / 25)}px Inter`;
        
        let message = 'Session ended.';
        if (isListening) {
            message = isRecording.current ? 'Recording...' : (isVoiceActive.current ? 'Voice detected...' : 'Listening...');
        } else if (appState === 'active') {
             if (statusMessage.toLowerCase().includes("error")) {
                message = statusMessage;
            }
        }
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    }, [isListening, statusMessage, appState]);


    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const isDesktop = window.innerWidth >= 769;
        canvas.width = isDesktop ? 600 : window.innerWidth * 0.9;
        canvas.height = isDesktop ? 400 : window.innerWidth * 0.6;
        if (!isListening) {
            drawDefaultCanvasState();
        }
    }, [isListening, drawDefaultCanvasState]);

    useEffect(() => {
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas(); // Initial call
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [resizeCanvas]);

    const stopListeningProcess = useCallback((dueToSilence = false) => {
        console.log("Stopping listening process.");
        const wasListening = isListening;

        setIsListening(false);
        isRecording.current = false;
        
        // Cleanup Audio Resources
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        if (microphoneStream.current) microphoneStream.current.getTracks().forEach(track => track.stop());
        if (scriptProcessor.current) scriptProcessor.current.disconnect();
        if (audioContext.current && audioContext.current.state !== 'closed') audioContext.current.close();
        
        animationFrameId.current = null;
        microphoneStream.current = null;
        scriptProcessor.current = null;
        audioContext.current = null;
        analyser.current = null;

        // Cleanup WebSocket
        if (websocket.current && websocket.current.readyState === WebSocket.OPEN) {
            websocket.current.close(1000, "Client stopping session.");
        }
        websocket.current = null;
        
        if (wasListening) {
            setStatusMessage(dueToSilence ? 'Session ended (silence).' : 'Session stopped.');
            setSttStatusMessage('Ready for a new session.');
        }
        
        setAppState('idle');
    }, [isListening]);


    const drawVisualization = useCallback(() => {
        if (!isListening) {
            if(animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
            animationFrameId.current = null;
            return;
        }

        animationFrameId.current = requestAnimationFrame(drawVisualization);
        const now = Date.now();
        const dataArray = new Uint8Array(analyser.current?.frequencyBinCount || 0);

        if (analyser.current && dataArray) {
            analyser.current.getByteFrequencyData(dataArray);
            
            let sumOfSquares = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const value = dataArray[i] / 255.0;
                sumOfSquares += value * value;
            }
            const rms = Math.sqrt(sumOfSquares / dataArray.length);
            const currentActualActivity = rms * 100;
            
            activityHistory.current.push(currentActualActivity);
            if (activityHistory.current.length > ACTIVITY_HISTORY_SIZE) {
                activityHistory.current.shift();
            }
            
            const avgActivity = activityHistory.current.reduce((a, b) => a + b, 0) / activityHistory.current.length;
            const peakActivity = Math.max(...activityHistory.current);
            
            activityLevel.current = Math.max(avgActivity, activityLevel.current * (1 - ACTIVITY_DECAY));
            const wasRecording = isRecording.current;
            const isVoiceDetected = (avgActivity > SILENCE_THRESHOLD) && (peakActivity > (SILENCE_THRESHOLD * 1.5));
            isVoiceActive.current = isVoiceDetected;

            if (isVoiceDetected) {
                if (!wasRecording && recordingStartTime.current === 0) {
                    recordingStartTime.current = now;
                }
                const timeElapsed = recordingStartTime.current > 0 ? now - recordingStartTime.current : 0;
                if (timeElapsed >= MIN_ACTIVITY_DURATION || wasRecording) {
                    isRecording.current = true;
                    silenceStart.current = 0;
                }
            } else {
                if (wasRecording) {
                    silenceStart.current = now;
                }
                if (silenceStart.current > 0 && (now - silenceStart.current) > MIN_SILENCE_DURATION_TO_PAUSE) {
                    isRecording.current = false;
                    recordingStartTime.current = 0;
                }
            }
        }
        
        if (!isRecording.current && silenceStart.current > 0 && (now - silenceStart.current > MAX_SILENCE_DURATION_TO_DISCONNECT)) {
            console.log("Prolonged silence detected. Stopping session.");
            stopListeningProcess(true);
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (!isRecording.current && !isVoiceActive.current) {
            drawDefaultCanvasState();
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const radius = Math.max(50, Math.min(canvas.width, canvas.height) * 0.3);
            const numBars = 128;
            for (let i = 0; i < numBars; i++) {
                const barIndex = Math.floor(i * (dataArray.length / numBars));
                const dataValue = dataArray[barIndex] / 255.0;
                let barHeight = dataValue * Math.min(canvas.width, canvas.height) * 0.35;
                barHeight = Math.max(2, barHeight);
                const angle = (i / numBars) * 2 * Math.PI - (Math.PI / 2);
                const x1 = centerX + radius * Math.cos(angle);
                const y1 = centerY + radius * Math.sin(angle);
                const x2 = centerX + (radius + barHeight) * Math.cos(angle);
                const y2 = centerY + (radius + barHeight) * Math.sin(angle);
                const hue = 190 + (dataValue * 50);
                ctx.strokeStyle = `hsl(${hue % 360}, 85%, 50%)`;
                ctx.lineWidth = Math.max(1.5, (2 * Math.PI * radius) / numBars * 0.7);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        }
    }, [isListening, stopListeningProcess, drawDefaultCanvasState]);

    const startListeningProcess = useCallback(async () => {
        if (isListening) return;
        console.log("Starting listening process...");
        
        setAppState('active');
        isRecording.current = false;
        isVoiceActive.current = false;
        silenceStart.current = 0;
        activityLevel.current = 0;
        activityHistory.current = [];
        recordingStartTime.current = 0;
        logCounter.current = 0;
        setStatusMessage("Initializing microphone...");
        setSttStatusMessage("");

        // Setup Audio
        try {
            const newAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            audioContext.current = newAudioContext;
            if (newAudioContext.state === 'suspended') await newAudioContext.resume();
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: { ideal: 16000 }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false, latency: { ideal: 0.01 } }, video: false });
            microphoneStream.current = stream;

            const source = newAudioContext.createMediaStreamSource(stream);
            const newAnalyser = newAudioContext.createAnalyser();
            newAnalyser.fftSize = 2048;
            analyser.current = newAnalyser;
            source.connect(newAnalyser);

            const newScriptProcessor = newAudioContext.createScriptProcessor(4096, 1, 1);
            scriptProcessor.current = newScriptProcessor;
            
            newScriptProcessor.onaudioprocess = (event) => {
                if (!isListening) return;
                const inputData = event.inputBuffer.getChannelData(0);
                if (isRecording.current && websocket.current && websocket.current.readyState === WebSocket.OPEN) {
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        const clampedSample = Math.max(-1, Math.min(1, inputData[i]));
                        pcmData[i] = clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7FFF;
                    }
                    websocket.current.send(pcmData.buffer);
                }
            };
            source.connect(newScriptProcessor);
            const gainNode = newAudioContext.createGain();
            gainNode.gain.setValueAtTime(0, newAudioContext.currentTime);
            newScriptProcessor.connect(gainNode);
            gainNode.connect(newAudioContext.destination);

        } catch (err) {
            console.error('Error setting up audio processing:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setStatusMessage(`Mic Error: ${errorMessage}.`);
            setSttStatusMessage("Check browser permissions.");
            stopListeningProcess();
            return;
        }

        // Setup WebSocket
        setStatusMessage("Connecting to speech service...");
        const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const WS_HOST = "support-api.lnkrtech.com"; // Replace with your actual deployed host
        // const WS_HOST = window.location.host; // For local testing
        const WS_URL = `${WS_PROTOCOL}//${WS_HOST}/api/v1/ws/speech-to-text?language=ar-EG&sample_rate=16000&encoding=LINEAR16`;
        
        try {
            const ws = new WebSocket(WS_URL);
            websocket.current = ws;
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);
                ws.onopen = () => { clearTimeout(timeout); resolve(true); };
                ws.onerror = (err) => { clearTimeout(timeout); reject(err); };
                ws.onclose = () => { clearTimeout(timeout); reject(new Error("Connection closed before opening.")); };
            });

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === "transcription" && data.text && data.text.trim().length > 0) {
                    setSttStatusMessage(`"${data.text}"`);
                }
            };
            ws.onclose = (event) => {
                console.log(`WebSocket closed. Code: ${event.code}, Reason: "${event.reason}"`);
                if (isListening) {
                    stopListeningProcess();
                }
            };

            console.log("Connection successful. Starting visualization loop.");
            setIsListening(true);
            setStatusMessage("Listening... Speak now.");
            drawVisualization();

        } catch (error) {
            console.error("Failed to establish WebSocket connection:", error);
            setStatusMessage("Error connecting to service.");
            setSttStatusMessage("Please try again.");
            stopListeningProcess();
        }
    }, [isListening, drawVisualization, stopListeningProcess]);


    const handleStartClick = () => {
        if (appState === 'idle') {
            startListeningProcess();
        }
    };

    return (
        <>
            {appState === 'idle' && (
                <div id="startScreen">
                    <h1>Lnkr Support</h1>
                    <button id="startButton" onClick={handleStartClick}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                        </svg>
                    </button>
                    <p>{statusMessage}</p>
                </div>
            )}

            {appState === 'active' && (
                <div id="mainApp" style={{ display: 'flex' }}>
                    <div className="app-container">
                        <canvas id="visualizationCanvas" ref={canvasRef}></canvas>
                        <div id="statusMessages" className="status-container">
                            <p id="statusMessage">{statusMessage}</p>
                            <p id="sttStatusMessage">{sttStatusMessage}</p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}