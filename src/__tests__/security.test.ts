import { sanitizeUrl } from '../utils/security'

describe('Security Utilities', () => {
  describe('sanitizeUrl', () => {
    it('should return empty string for null, undefined, or empty string', () => {
      expect(sanitizeUrl(null)).toBe('')
      expect(sanitizeUrl(undefined)).toBe('')
      expect(sanitizeUrl('')).toBe('')
    })

    it('should mask credentials in RTSP urls', () => {
      const url = 'rtsp://admin:mySecret123@192.168.1.100:554/ch0_0.264'
      expect(sanitizeUrl(url)).toBe('rtsp://admin:***@192.168.1.100:554/ch0_0.264')
    })

    it('should mask credentials in RTMP urls', () => {
      const url = 'rtmp://streamuser:supersecret@live.twitch.tv/app'
      expect(sanitizeUrl(url)).toBe('rtmp://streamuser:***@live.twitch.tv/app')
    })

    it('should leave urls without credentials untouched', () => {
      const hls = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8'
      expect(sanitizeUrl(hls)).toBe(hls)

      const rtspNoAuth = 'rtsp://192.168.1.100:554/live'
      expect(sanitizeUrl(rtspNoAuth)).toBe(rtspNoAuth)
    })
  })
})
