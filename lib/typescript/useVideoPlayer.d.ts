import type { VideoPlayerView, PlaybackState, ProgressEvent } from './VideoPlayer.nitro';
export interface VideoPlayerState {
    /** Single source of truth for playback – drives the native `paused` prop */
    paused: boolean;
    playbackState: PlaybackState;
    currentTime: number;
    duration: number;
    isBuffering: boolean;
    volume: number;
    isMuted: boolean;
    error: string | null;
}
interface UseVideoPlayerOptions {
    /** Initial paused state (can be kept in sync with an external prop) */
    initialPaused?: boolean;
    /** Initial volume (0.0 to 1.0). Default: 1.0 */
    initialVolume?: number;
    /** Initial muted state. Default: true */
    initialMuted?: boolean;
}
export declare function useVideoPlayer(options?: UseVideoPlayerOptions): {
    ref: import("react").RefObject<VideoPlayerView | null>;
    state: VideoPlayerState;
    play: () => void;
    pause: () => void;
    stop: () => void;
    seekTo: (seconds: number) => void;
    seekBy: (targetSeconds: number) => void;
    setVolume: (v: number) => void;
    toggleMute: () => void;
    takeScreenshot: () => Promise<string>;
    onStateChange: (s: PlaybackState) => void;
    onProgress: (e: ProgressEvent) => void;
    onBuffering: (b: boolean) => void;
    onError: (e: {
        message: string;
    }) => void;
    onEnd: () => void;
    onReady: () => void;
};
export {};
//# sourceMappingURL=useVideoPlayer.d.ts.map