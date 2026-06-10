export function isAudioEnabled() {
  return localStorage.getItem('audio_enabled') === 'true'
}

export function setAudioEnabled(val) {
  localStorage.setItem('audio_enabled', String(val))
}

export function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const t = ctx.currentTime

    function bell(freq, vol, dur) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(vol, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.start(t)
      osc.stop(t + dur)
    }

    bell(1047, 0.22, 1.2)
    bell(2093, 0.09, 0.8)
    bell(3136, 0.04, 0.5)

    setTimeout(() => ctx.close(), 1500)
  } catch {}
}
