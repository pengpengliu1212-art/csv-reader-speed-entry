// Fast drop-in for make.fun's csv-reader 1.0.0: run(input) returns exactly
// csv-reader's answer for {text, header}, the JSON value {columns, rows, errors}.
//
// Same reading policy as the reference (see competition.yaml): a U+FEFF at the
// very start is dropped; a record ends at LF or CRLF and a line left with no
// characters is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field that opens with a quote runs to the next quote that is
// not doubled, "" inside it one quote and each CRLF or lone CR inside it read
// as LF; what follows its closing quote, up to the next comma or line break,
// is appended as it stands (quote_junk, when the field ends); a quote that
// never closes is a literal character and the text after it is read again as
// unquoted (unterminated_quote); a quote inside an unquoted field is literal;
// fields stay strings, never trimmed or converted; columns is the first record
// when header is true, else null; rows are padded (short_row, with fields: its
// count) or cut (long_row, with extra: the cut fields) to the first record's
// width; each error is {code, line, row} in the order met, line the 1-based
// line its record starts on, row its record's index in rows (null for the
// header).
//
// How it is faster than the reference: the reference reads one character at a
// time and builds every field a character at a time. This reader instead
//   - scans an unquoted field with a tight charCodeAt loop that only looks
//     for its end, then takes the field with one slice;
//   - finds a quoted field's closing quote with indexOf (skipping "" escapes
//     the same way) and takes its content with one slice, only falling back
//     to a slow path when the span holds an escape, a CR or a line break;
//   - keeps every slow path (stray CRs, quote junk, unterminated quotes,
//     quoted line breaks) exactly as the reference reads them, so the only
//     difference from the reference is speed, never a byte of output.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Deterministic: two runs write the same bytes.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Slow unquoted scan from `from`, appending the field's kept segments to
  // `parts`: a CR not followed by LF is dropped (stray_cr) and the field goes
  // on. Updates pos and line. Returns [ended, added], added the kept
  // characters. Only used where the fast path already met a stray CR, for
  // quote junk and for an unterminated quote's re-read.
  function scanUnquoted(from, parts) {
    let added = 0;
    let j = from;
    for (;;) {
      let k = j;
      while (k < len) {
        const cc = text.charCodeAt(k);
        if (cc === 44 || cc === 10 || cc === 13) break;
        k++;
      }
      if (k >= len) {
        parts.push(text.slice(j, len));
        added += len - j;
        pos = len;
        return [END, added];
      }
      const cc = text.charCodeAt(k);
      if (cc === 44) {
        parts.push(text.slice(j, k));
        added += k - j;
        pos = k + 1;
        return [COMMA, added];
      }
      if (cc === 10) {
        parts.push(text.slice(j, k));
        added += k - j;
        pos = k + 1;
        line++;
        return [LINE_BREAK, added];
      }
      if (k + 1 < len && text.charCodeAt(k + 1) === 10) {
        parts.push(text.slice(j, k));
        added += k - j;
        pos = k + 2;
        line++;
        return [LINE_BREAK, added];
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      parts.push(text.slice(j, k));
      added += k - j;
      j = k + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        // ---- Quoted field: find its closing quote with indexOf. ----
        const open = pos;
        const openLine = line;
        let close = text.indexOf('"', pos + 1);
        let hasEsc = false;
        while (close !== -1 && text.charCodeAt(close + 1) === 34) {
          hasEsc = true; // a "" escape: the quote is content, keep looking
          close = text.indexOf('"', close + 2);
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const parts = ['"'];
          ended = scanUnquoted(pos, parts)[0];
          fields.push(parts.join(''));
          continue;
        }
        let value = text.slice(open + 1, close);
        if (hasEsc) value = value.replaceAll('""', '"');
        // CRLF and a lone CR inside quotes are each one LF, and every line
        // break inside quotes counts a line.
        const hasCR = value.indexOf('\r') !== -1;
        const hasNL = value.indexOf('\n') !== -1;
        if (hasCR || hasNL) {
          const breaks = value.match(/\r\n?|\n/g);
          line += breaks === null ? 0 : breaks.length;
          if (hasCR) value = value.replace(/\r\n?/g, '\n');
        }
        pos = close + 1;
        if (pos >= len) {
          fields.push(value);
          ended = END;
        } else {
          const nc = text.charCodeAt(pos);
          if (nc === 44) {
            fields.push(value);
            pos++;
            ended = COMMA;
          } else if (nc === 10) {
            fields.push(value);
            pos++;
            line++;
            ended = LINE_BREAK;
          } else if (nc === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
            fields.push(value);
            pos += 2;
            line++;
            ended = LINE_BREAK;
          } else {
            // What follows the closing quote is appended as it stands, up to
            // the next comma or line break (quote_junk, when the field ends).
            const parts = [value];
            const r = scanUnquoted(pos, parts);
            ended = r[0];
            if (r[1] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            fields.push(r[1] > 0 ? parts.join('') : value);
          }
        }
      } else {
        quoted = false;
        // ---- Unquoted field: scan only for its end, then one slice. ----
        const start = pos;
        let i = pos;
        while (i < len) {
          const cc = text.charCodeAt(i);
          if (cc === 44 || cc === 10 || cc === 13) break;
          i++;
        }
        if (i >= len) {
          fields.push(text.slice(start, len));
          pos = len;
          ended = END;
        } else {
          const cc = text.charCodeAt(i);
          if (cc === 44) {
            fields.push(text.slice(start, i));
            pos = i + 1;
            ended = COMMA;
          } else if (cc === 10) {
            fields.push(text.slice(start, i));
            pos = i + 1;
            line++;
            ended = LINE_BREAK;
          } else if (i + 1 < len && text.charCodeAt(i + 1) === 10) {
            fields.push(text.slice(start, i));
            pos = i + 2;
            line++;
            ended = LINE_BREAK;
          } else {
            // A CR not followed by LF is dropped (stray_cr) and the field
            // goes on: fall back to the segment scan.
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            const parts = [text.slice(start, i)];
            ended = scanUnquoted(i + 1, parts)[0];
            fields.push(parts.join(''));
          }
        }
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
