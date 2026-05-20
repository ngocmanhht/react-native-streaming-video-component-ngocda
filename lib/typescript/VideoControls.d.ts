import { type ComponentType, type FC } from 'react';
import type { StreamProtocol } from './VideoPlayer.nitro';
import type { VideoPlayerState } from './useVideoPlayer';
export interface IconProps {
    size?: number;
    color?: string;
    strokeWidth?: number;
}
export interface ControlIcons {
    play?: ComponentType<IconProps>;
    pause?: ComponentType<IconProps>;
    stop?: ComponentType<IconProps>;
    seekBack?: ComponentType<IconProps>;
    seekForward?: ComponentType<IconProps>;
    volumeHigh?: ComponentType<IconProps>;
    volumeLow?: ComponentType<IconProps>;
    volumeMute?: ComponentType<IconProps>;
    fullscreen?: ComponentType<IconProps>;
    exitFullscreen?: ComponentType<IconProps>;
    zoomIn?: ComponentType<IconProps>;
    zoomOut?: ComponentType<IconProps>;
    camera?: ComponentType<IconProps>;
}
export interface VideoControlsProps {
    state: VideoPlayerState;
    streamProtocol: StreamProtocol;
    isFullscreen: boolean;
    seekInterval?: number;
    icons?: ControlIcons;
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onSeekBy: (absoluteSeconds: number) => void;
    onVolumeChange: (volume: number) => void;
    onToggleMute: () => void;
    onToggleFullscreen: () => void;
    showCameraButton?: boolean;
    onCapture?: () => void;
}
export declare const VideoControls: FC<VideoControlsProps>;
//# sourceMappingURL=VideoControls.d.ts.map