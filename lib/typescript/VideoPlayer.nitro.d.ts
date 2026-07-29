import type { HybridView, HybridViewProps, HybridViewMethods } from 'react-native-nitro-modules';
export type StreamProtocol = 'hls' | 'rtsp' | 'rtmp' | 'mp4';
export type ResizeMode = 'contain' | 'cover' | 'fill';
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'reconnecting' | 'error' | 'ended';
export interface NaturalSize {
    width: number;
    height: number;
}
export interface ProgressEvent {
    currentTime: number;
    duration: number;
    playableDuration: number;
}
export interface ErrorEvent {
    code: number;
    message: string;
    streamProtocol?: StreamProtocol;
    nativeError?: string;
    recoverable?: boolean;
}
export interface ReadyEvent {
    duration: number;
    naturalSize: NaturalSize;
}
export interface VideoPlayerProps extends HybridViewProps {
    url: string;
    streamProtocol: StreamProtocol;
    paused: boolean;
    resizeMode: ResizeMode;
    volume: number;
    muted: boolean;
    shouldRepeat: boolean;
    progressInterval: number;
    zoomEnabled: boolean;
    isLive: boolean;
    onReady?: (event: ReadyEvent) => void;
    onProgress?: (event: ProgressEvent) => void;
    onBuffering?: (isBuffering: boolean) => void;
    onStateChange?: (state: PlaybackState) => void;
    onError?: (event: ErrorEvent) => void;
    onEnd?: () => void;
}
export interface VideoPlayerMethods extends HybridViewMethods {
    play(): void;
    pause(): void;
    stop(): void;
    seekTo(positionSeconds: number): Promise<void>;
    getCurrentTime(): Promise<number>;
    getDuration(): Promise<number>;
    /** iOS only — cast to AirPlay */
    presentAirPlayPicker(): void;
    /** Captures the current video frame and returns the file URI */
    takeScreenshot(): Promise<string>;
}
export type VideoPlayerView = HybridView<VideoPlayerProps, VideoPlayerMethods>;
//# sourceMappingURL=VideoPlayer.nitro.d.ts.map