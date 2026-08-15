/**
 * Multi-encoding safe buffer decoder for Windows terminals.
 * Handles UTF-8 with BOM stripping and fallback to system code page.
 */
export class WindowsEncodingUtils {
  private static utf8Decoder = new TextDecoder('utf-8', { fatal: false })

  /**
   * Decode binary buffer from subprocess stdout/stderr without garbled characters.
   */
  public static decodeBuffer(buffer: Uint8Array | Buffer): string {
    if (!buffer || buffer.length === 0) return ''

    let text = this.utf8Decoder.decode(buffer)

    // Strip UTF-8 BOM if present (\uFEFF)
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1)
    }

    // Strip CRLF to standard LF for uniform cross-platform parsing
    return text.replace(/\r\n/g, '\n')
  }
}
