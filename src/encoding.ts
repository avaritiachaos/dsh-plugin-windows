/**
 * Multi-encoding safe buffer decoder for Windows terminals.
 * Handles UTF-8 with BOM stripping and line ending normalization.
 */
export class WindowsEncodingUtils {
  private static utf8Decoder = new TextDecoder('utf-8', { fatal: false })

  public static stripBom(text: string): string {
    if (!text) return ''
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  }

  public static normalizeLineEndings(text: string): string {
    if (!text) return ''
    return text.replace(/\r\n/g, '\n')
  }

  /**
   * Decode binary buffer from subprocess stdout/stderr without garbled characters.
   */
  public static decodeBuffer(buffer: Uint8Array | Buffer): string {
    if (!buffer || buffer.length === 0) return ''
    const text = this.utf8Decoder.decode(buffer)
    return this.normalizeLineEndings(this.stripBom(text))
  }
}
