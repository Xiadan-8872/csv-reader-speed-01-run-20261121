// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// Same answers, byte for byte as JSON values, on every input — including all
// of csv-reader's broken-row policy (BOM, stray CR, unterminated quotes,
// quote junk, short/long rows, blank lines, CR/LF normalisation inside
// quotes) — but built from slices and indexOf scans instead of one
// character at a time, so the common cases never touch a per-character loop.
//
// Strategy:
//  * A record whose first physical line holds no '"' and no stray '\r' is
//    answered with one String.split(',') on that line (the fast path).
//  * Every other field is read with indexOf jumps: an unquoted field finds
//    its next ',' / '\n' / '\r' and slices it whole; a quoted field finds
//    its next '"' and slices it whole, only scanning character by character
//    when a segment actually holds a '\r' that must be normalised to '\n'.
//  * Line numbers are counted from the slices (a normalised quoted
//    segment's '\n' count is its line delta), never per character.
//  * Errors are pushed in exactly the order csv-reader meets them: a
//    field's stray_cr / unterminated_quote / quote_junk as its field is
//    read, then the record's short_row / long_row when the record ends.
//
// No dependencies, no state kept between calls, no caching between cases.

// ended codes: 0 = comma, 1 = line break, 2 = end of text
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** A quoted segment [a, b): '\r' / '\r\n' inside it become '\n', else the slice itself. */
function normalizeSegment(text, a, b) {
  const r = text.indexOf('\r', a);
  if (r === -1 || r >= b) return text.slice(a, b);
  const parts = [];
  let prev = a;
  let i = a;
  while (i < b) {
    if (text.charCodeAt(i) === 13) {
      parts.push(text.slice(prev, i), '\n');
      i += i + 1 < b && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      prev = i;
    } else {
      i += 1;
    }
  }
  parts.push(text.slice(prev, b));
  return parts.join('');
}

/** Number of '\n' in s (after normalisation every line break is one '\n'). */
function countLF(s) {
  let c = 0;
  let i = -1;
  while ((i = s.indexOf('\n', i + 1)) !== -1) c += 1;
  return c;
}

/**
 * Read an unquoted field starting at st.pos, with `initial` already in the
 * value ('' for a plain field, the quoted content for quote junk, '"' for
 * an unterminated quote re-read). Sets st.value / st.ended / st.added and
 * advances st.pos / st.line. Stray '\r' errors are pushed as met.
 */
function readUnquoted(st, initial) {
  const text = st.text;
  const n = st.n;
  const errors = st.errors;
  const recordLine = st.recordLine;
  const recordRow = st.recordRow;
  let value = initial;
  let added = 0;
  let seg = st.pos; // start of the current slice segment
  let pos = st.pos;
  while (true) {
    const iComma = text.indexOf(',', pos);
    const iLF = text.indexOf('\n', pos);
    const iCR = text.indexOf('\r', pos);
    let d = -1;
    let kind = -1; // 0 comma, 1 LF, 2 CR
    if (iComma !== -1) { d = iComma; kind = 0; }
    if (iLF !== -1 && (d === -1 || iLF < d)) { d = iLF; kind = 1; }
    if (iCR !== -1 && (d === -1 || iCR < d)) { d = iCR; kind = 2; }
    if (d === -1) {
      // End of text: keep the rest.
      const tail = text.slice(seg, n);
      if (tail.length !== 0) { value = value.length === 0 ? tail : value + tail; added += tail.length; }
      st.pos = n;
      st.value = value;
      st.ended = END;
      st.added = added;
      return;
    }
    if (kind === 2) {
      if (d + 1 < n && text.charCodeAt(d + 1) === 10) {
        // CRLF line break.
        const tail = text.slice(seg, d);
        if (tail.length !== 0) { value = value.length === 0 ? tail : value + tail; added += tail.length; }
        st.pos = d + 2;
        st.line += 1;
        st.value = value;
        st.ended = BREAK;
        st.added = added;
        return;
      }
      // Stray CR: dropped, error, field continues.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      const tail = text.slice(seg, d);
      if (tail.length !== 0) { value = value.length === 0 ? tail : value + tail; added += tail.length; }
      pos = d + 1;
      seg = d + 1;
      continue;
    }
    // Comma or LF.
    const tail = text.slice(seg, d);
    if (tail.length !== 0) { value = value.length === 0 ? tail : value + tail; added += tail.length; }
    if (kind === 0) {
      st.pos = d + 1;
      st.ended = COMMA;
    } else {
      st.pos = d + 1;
      st.line += 1;
      st.ended = BREAK;
    }
    st.value = value;
    st.added = added;
    return;
  }
}

/**
 * Read a quoted field whose opening quote is at st.pos. Sets st.value /
 * st.ended (and st.added for the junk case) and advances st.pos / st.line.
 * An unterminated quote is re-read as unquoted from just after the quote.
 */
function readQuoted(st) {
  const text = st.text;
  const n = st.n;
  const errors = st.errors;
  const recordLine = st.recordLine;
  const recordRow = st.recordRow;
  const open = st.pos;
  const openLine = st.line;
  let value = '';
  let seg = open + 1; // start of the current quoted segment
  let scan = open + 1;
  let lineDelta = 0;
  while (true) {
    const q = text.indexOf('"', scan);
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      st.pos = open + 1;
      st.line = openLine;
      readUnquoted(st, '"');
      return;
    }
    if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
      // Doubled quote: one literal quote, field continues.
      const part = normalizeSegment(text, seg, q);
      lineDelta += countLF(part);
      value += part + '"';
      scan = q + 2;
      seg = q + 2;
      continue;
    }
    // Closing quote at q.
    const part = normalizeSegment(text, seg, q);
    lineDelta += countLF(part);
    value += part;
    st.line += lineDelta;
    const after = q + 1;
    if (after >= n) {
      st.pos = n;
      st.value = value;
      st.ended = END;
      st.added = 0;
      return;
    }
    const c = text.charCodeAt(after);
    if (c === 44) { // ','
      st.pos = after + 1;
      st.value = value;
      st.ended = COMMA;
      st.added = 0;
      return;
    }
    if (c === 10) { // '\n'
      st.pos = after + 1;
      st.line += 1;
      st.value = value;
      st.ended = BREAK;
      st.added = 0;
      return;
    }
    if (c === 13 && after + 1 < n && text.charCodeAt(after + 1) === 10) {
      st.pos = after + 2;
      st.line += 1;
      st.value = value;
      st.ended = BREAK;
      st.added = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    st.pos = after;
    readUnquoted(st, value);
    if (st.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return;
  }
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  // Per-case mutable parse state, shared with the field readers above.
  const st = { text, n, pos: 0, line: 1, errors, recordLine: 1, recordRow: null, value: '', ended: END, added: 0 };
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) st.pos = 1;

  while (true) {
    // Lines with no characters are no records.
    let pos = st.pos;
    let line = st.line;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    st.pos = pos;
    st.line = line;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    st.recordLine = recordLine;
    st.recordRow = recordRow;

    let fields;
    let quotedLast = false;

    // Fast path: the record's first physical line holds no '"' and no
    // stray '\r', so the whole record is that line split on ','.
    const iLF = text.indexOf('\n', pos);
    const lineEnd = iLF === -1 ? n : iLF;
    // Only a '\r' just before a real '\n' is the CRLF line break; a '\r'
    // at the end of the text (no '\n' after it) is a stray CR, not a break.
    const contentEnd = iLF !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    const qInLine = text.indexOf('"', pos);
    const rInLine = text.indexOf('\r', pos);
    if ((qInLine === -1 || qInLine >= contentEnd) && (rInLine === -1 || rInLine >= contentEnd)) {
      fields = text.slice(pos, contentEnd).split(',');
      st.pos = iLF === -1 ? n : iLF + 1;
      st.line = line + (iLF === -1 ? 0 : 1);
    } else {
      // Slow path: field by field.
      fields = [];
      while (true) {
        if (text.charCodeAt(st.pos) === 34) {
          quotedLast = true;
          readQuoted(st);
        } else {
          quotedLast = false;
          readUnquoted(st, '');
        }
        fields.push(st.value);
        if (st.ended !== COMMA) break;
      }
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;

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
