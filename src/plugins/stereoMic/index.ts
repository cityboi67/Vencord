/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    stereoInput: {
        type: OptionType.BOOLEAN,
        description: "Enable stereo microphone input (2 audio channels)",
        default: true,
        restartNeeded: false,
    },
    channelCount: {
        type: OptionType.SELECT,
        description: "Number of audio input channels",
        options: [
            { label: "Mono (1 channel)", value: 1, default: false },
            { label: "Stereo (2 channels)", value: 2, default: true },
        ],
    },
    sampleRate: {
        type: OptionType.SELECT,
        description: "Microphone sample rate in Hz (higher = better quality)",
        options: [
            { label: "8,000 Hz (telephone quality)", value: 8000, default: false },
            { label: "16,000 Hz (wideband)", value: 16000, default: false },
            { label: "24,000 Hz (Opus default)", value: 24000, default: false },
            { label: "44,100 Hz (CD quality)", value: 44100, default: false },
            { label: "48,000 Hz (Discord/broadcast, recommended)", value: 48000, default: true },
            { label: "96,000 Hz (studio quality)", value: 96000, default: false },
        ],
    },
    echoCancellation: {
        type: OptionType.BOOLEAN,
        description: "Enable echo cancellation (disable if using headphones or an interface)",
        default: false,
        restartNeeded: false,
    },
    noiseSuppression: {
        type: OptionType.BOOLEAN,
        description: "Enable noise suppression (disable for music/instrument input)",
        default: false,
        restartNeeded: false,
    },
    autoGainControl: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic gain control (disable for manual volume control)",
        default: false,
        restartNeeded: false,
    },
    latency: {
        type: OptionType.SELECT,
        description: "Preferred microphone capture latency",
        options: [
            { label: "Minimum (lowest latency, may introduce instability)", value: "min", default: false },
            { label: "Low (~10ms)", value: "low", default: false },
            { label: "Normal (~20ms, recommended)", value: "normal", default: true },
            { label: "High (~40ms, more stable)", value: "high", default: false },
        ],
    },
    voiceProcessing: {
        type: OptionType.BOOLEAN,
        description: "Enable browser/OS-level voice processing pipeline",
        default: false,
        restartNeeded: false,
    },
    sampleSize: {
        type: OptionType.SELECT,
        description: "Bit depth (sample size) per audio sample",
        options: [
            { label: "8-bit", value: 8, default: false },
            { label: "16-bit (recommended)", value: 16, default: true },
            { label: "24-bit", value: 24, default: false },
            { label: "32-bit", value: 32, default: false },
        ],
    },
});

type LatencyValue = "min" | "low" | "normal" | "high";

const latencyMap: Record<LatencyValue, number | undefined> = {
    min: 0,
    low: 0.01,
    normal: 0.02,
    high: 0.04,
};

let origGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;

function buildAudioConstraints(): MediaTrackConstraints {
    const latency = settings.store.latency as LatencyValue;
    const voiceProcessing = settings.store.voiceProcessing;

    const constraints: MediaTrackConstraints = {
        echoCancellation: settings.store.echoCancellation,
        noiseSuppression: settings.store.noiseSuppression,
        autoGainControl: settings.store.autoGainControl,
        // @ts-ignore - goog* constraints are Chromium-specific non-standard extensions
        googEchoCancellation: voiceProcessing && settings.store.echoCancellation,
        googAutoGainControl: voiceProcessing && settings.store.autoGainControl,
        googNoiseSuppression: voiceProcessing && settings.store.noiseSuppression,
        googHighpassFilter: voiceProcessing && settings.store.noiseSuppression,
        googEchoCancellation2: voiceProcessing && settings.store.echoCancellation,
        googAutoGainControl2: voiceProcessing && settings.store.autoGainControl,
    };

    if (settings.store.stereoInput) {
        constraints.channelCount = {
            ideal: settings.store.channelCount as number,
            min: 1,
        };
    }

    if (settings.store.sampleRate) {
        constraints.sampleRate = {
            ideal: settings.store.sampleRate as number,
        };
    }

    if (settings.store.sampleSize) {
        constraints.sampleSize = {
            ideal: settings.store.sampleSize as number,
        };
    }

    const latencyValue = latencyMap[latency];
    if (latencyValue !== undefined) {
        constraints.latency = {
            ideal: latencyValue,
        };
    }

    return constraints;
}

export default definePlugin({
    name: "StereoMic",
    description: "Enables stereo microphone input in Discord voice calls with full audio quality control",
    authors: [Devs.Ven],
    settings,

    patches: [
        // Patch the Opus SDP to negotiate stereo with the remote end
        {
            find: "usedtx=",
            noWarn: true,
            replacement: {
                match: /;usedtx=\$\{(\i)\?"0":"1"\}/,
                replace: '$&${$self.getStereoSdpParam()}',
            },
        },
    ],

    getStereoSdpParam(): string {
        if (!settings.store.stereoInput) return "";
        // sprop-stereo: tell the remote side we are sending stereo
        // stereo: tell the remote side we can receive stereo
        return ";stereo=1;sprop-stereo=1";
    },

    start() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

        origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

        navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
            if (constraints?.audio && settings.store.stereoInput) {
                const existingAudio: MediaTrackConstraints =
                    typeof constraints.audio === "boolean" ? {} : { ...constraints.audio };

                constraints = {
                    ...constraints,
                    audio: {
                        ...existingAudio,
                        ...buildAudioConstraints(),
                    },
                };
            }

            return origGetUserMedia!(constraints);
        };
    },

    stop() {
        if (origGetUserMedia) {
            navigator.mediaDevices.getUserMedia = origGetUserMedia;
            origGetUserMedia = null;
        }
    },
});
