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
   * Decode binary buffer from subprocess stdout/stderr.
   *
   * @param encoding WHATWG TextDecoder label, e.g. 'utf-8', 'gbk' (CP936),
   *                 'windows-1252' (CP1252), 'ibm850' (CP850). Falls back to
   *                 UTF-8 when the label is unsupported by the runtime.
   */
  public static decodeBuffer(buffer: Uint8Array | Buffer, encoding = 'utf-8'): string {
    if (!buffer || buffer.length === 0) return ''
    let text: string
    try {
      text = new TextDecoder(encoding, { fatal: false }).decode(buffer)
    } catch {
      text = this.utf8Decoder.decode(buffer)
    }
    return this.normalizeLineEndings(this.stripBom(text))
  }
}
