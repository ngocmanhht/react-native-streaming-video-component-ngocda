import { type FC, type RefObject } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import type { VideoPlayerProps, VideoPlayerView } from './VideoPlayer.nitro';
import { type ControlIcons } from './VideoControls';
export interface VideoPlayerPublicProps extends Omit<Partial<VideoPlayerProps>, 'paused' | 'volume' | 'muted' | 'zoomEnabled' | 'url'> {
    /** Stream URL */
    url?: string;
    /** Stream source string or object { uri: string } */
    source?: string | {
        uri?: string;
    };
    /** Custom styles applied to the container */
    style?: StyleProp<ViewStyle>;
    /**
     * Controls playback. When provided, the component is "controlled" –
     * you must update this prop to play/pause. When omitted, the component
     * manages playback internally (uncontrolled mode).
     */
    paused?: boolean;
    /** Initial volume, 0.0 – 1.0. Default: 1.0 */
    volume?: number;
    /** Initial muted state. Default: true */
    muted?: boolean;
    /** Show the built-in controls overlay. Default: false */
    showControls?: boolean;
    /** Enable pinch-to-zoom. Default: false */
    zoomEnabled?: boolean;
    /**
     * How many seconds seek-back / seek-forward buttons jump.
     * Ignored for RTSP and HLS (live streams). Default: 15
     */
    seekInterval?: number;
    /**
     * Override individual control icons.
     * Each value should be a React component accepting { size, color, strokeWidth }.
     */
    icons?: ControlIcons;
    /** Externally controlled ref – use with useVideoPlayer() */
    playerRef?: RefObject<VideoPlayerView>;
    /** Show the camera capture button. Default: false */
    showCameraButton?: boolean;
    /** Callback when screenshot is taken. Returns the file path. */
    onCapture?: (path: string) => void;
}
export declare const VideoPlayer: FC<VideoPlayerPublicProps>;
//# sourceMappingURL=VideoPlayer.d.ts.map