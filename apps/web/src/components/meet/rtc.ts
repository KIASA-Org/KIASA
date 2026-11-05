/** What a call between browsers needs, whoever is calling: a meeting, or a member's
 * sound on its way to an admin. */

export const VOICE_BITRATE = 64_000;

/** My offer or answer, asking the other side for a clearer voice than the
 * usual: Opus at up to 64 kbit/s, with what is lost on the way made up. (In
 * an offer or answer, these say how one wants to receive.) */
export function clearVoice(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  const sdp = description.sdp ?? "";
  const opus = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!opus) return description;
  return {
    ...description,
    sdp: sdp.replace(new RegExp(`a=fmtp:${opus} ([^\\r\\n]*)`), (line, params: string) =>
      /maxaveragebitrate/.test(params) ? line : `a=fmtp:${opus} ${params};maxaveragebitrate=${VOICE_BITRATE};useinbandfec=1`),
  };
}

/** Waits until a connection has found the ways to be reached that matter:
 * the address the internet sees (and, when a relay is set up, the relay's),
 * or all of them, at most a few seconds. They then travel inside its offer or
 * answer, in one message, rather than one by one after it, where a pair
 * offering at the same moment could lose them. */
export function gathered(pc: RTCPeerConnection, relay: boolean, most = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    let settle = 0;
    const finish = () => {
      pc.removeEventListener("icegatheringstatechange", changed);
      pc.removeEventListener("icecandidate", found);
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      resolve();
    };
    const changed = () => { if (pc.iceGatheringState === "complete") finish(); };
    // Enough found: a moment more for the rest of the same kind, then go.
    const found = ({ candidate }: RTCPeerConnectionIceEvent) => {
      if (candidate?.type === (relay ? "relay" : "srflx") && !settle) settle = window.setTimeout(finish, 150);
    };
    const timer = window.setTimeout(finish, most);
    pc.addEventListener("icegatheringstatechange", changed);
    pc.addEventListener("icecandidate", found);
  });
}
