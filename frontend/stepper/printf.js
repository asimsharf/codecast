
import * as C from 'persistent-c';

// not supported:
// - '*' width
// - 'L' length (long double)
// - 'g', 'G', 'a', 'A', 'n' specifiers

const re = {
  text: /^[^%]+/,
  percent: /^%%/,
  format_specifier: /^%([-+ #0]+)?([1-9]\d*)?(?:\.([1-9]\d*|\*))?(h|hh|l|ll|z|t)?([diuoxXfFeEcsp])/,
  sign: /^[\+\-]/
};

const formatCache = {};

export const sprintf = function (state, values) {
  // [printf, fmt, args...]
  const fmt = C.readString(state.memory, values[1]);
  if (!(fmt in formatCache && formatCache.hasOwnProperty(fmt))) {
    formatCache[fmt] = parseFormat(fmt);
  }
  return applyFormat(state, formatCache[fmt], values);
}

function parseFormat (fmt) {
  const ops = [];
  while (fmt.length > 0) {
    let match;
    if ((match = re.text.exec(fmt)) !== null) {
      ops.push({text: match[0]});
    }
    else if ((match = re.percent.exec(fmt)) !== null) {
      ops.push({text: "%"});
    }
    else if ((match = re.format_specifier.exec(fmt)) !== null) {
      const flags = match[1] || '';
      const zeroPad = /0/.test(flags);
      const leftJustify = /-/.test(flags);
      const signPositives = /\+/.test(flags);
      const spaceSign = / /.test(flags);
      const decorate = /#/.test(flags);
      const width = match[2];
      const precision = match[3];
      const length = match[4];
      const specifier = match[5];
      ops.push({zeroPad, leftJustify, signPositives, spaceSign, width, precision, length, specifier});
    }
    else {
      throw new SyntaxError(`printf: unexpected format specifier "${fmt}"`);
    }
    fmt = fmt.substring(match[0].length);
  }
  return ops;
};

function applyFormat (state, ops, values) {
  const output = [];
  let cursor = 2;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if ('text' in op) {
      output.push(op.text);
      continue;
    }

    let arg = values[cursor++];

    if (op.specifier === 'c') {
      output.push(String.fromCharCode(arg.toInteger()));
      continue;
    }

    let precision = op.precision;
    let prefix = '', suffix = '';

    if (op.specifier === 's') {
      /*
        For %s, the precision is the maximum number of characters to be printed.
        By default all characters are printed until the ending null character
        is encountered.
      */
      // TODO: pass op.precision to arg
      arg = C.readString(state.memory, arg /* op.precision */);
      if (precision !== null) {
        arg = arg.substring(0, precision);
      }
      output.push(justify(op, arg, '', '', ''));
      continue;
    }

    switch (op.specifier) {
      case "d":
      case "i":
        arg = zeroFill(arg.number.toString(), precision);
        break;
      case "u":
        arg = arg.number >>> 0;
        arg = zeroFill(arg.toString(), precision);
        break;
      case "o":
        arg = arg.number >>> 0;
        if (op.decorate && arg !== 0) {
          prefix = '0';
        }
        arg = zeroFill(arg.toString(8), precision);
        break;
      case "x":
        arg = arg.number >>> 0;
        if (op.decorate && arg !== 0) {
          prefix = '0x';
        }
        arg = zeroFill(arg.toString(16), precision);
        break;
      case "f":
        arg = arg.number.toFixed(precision || 6);
        if (op.decorate) {
          suffix = '.';
        }
        break;
      case "e":
        arg = arg.number.toExponential(precision || 6);
        if (op.decorate) {
          suffix = '.';
        }
        break;
      case "p":
        arg = (arg.number >>> 0).toString(16);
        break;
    }
    console.log('arg', typeof arg, arg);

    // Extract the sign.
    const sign = (arg >= 0) ? "+" : "-";
    arg = arg.replace(re.sign, "");

    // Justify.
    arg = justify(op, arg, sign, prefix, suffix);

    // Uppercase.
    if (/XFE/.test(op)) {
      arg = arg.toUpperCase();
    }

    output.push(arg);
  }
  return output.join('');
}

function replicate (count, text) {
  return Array(count).fill(text).join('');
}

function zeroFill (value, precision) {
  // precision specifies the minimum number of digits to be written.
  if (value.length < precision) {
    // If the value to be written is shorter than this number, the result is
    // padded with leading zeros.
    return replicate(precision - value.length, '0') + value;
  }
  if (precision === 0 && value === '0') {
    // A precision of 0 means that no character is written for the value 0.
    return '';
  }
  // The value is not truncated even if the result is longer.
  return value;
}

function justify (op, arg, sign, prefix, suffix) {
  // The sign argument is either '+', '-' (for numbers) or falsy (for strings).
  // Adjust what is actually output based on the flags.
  if (sign === '+' && !op.signPositives) {
    sign = op.spaceSign ? ' ' : '';
  }
  // The width specifieds the minimum number of characters to be printed.
  // If the value to be printed is shorter than this number, the result is
  // padded with blank spaces.
  let padding = '';
  const paddingLength = op.width - sign.length - prefix.length - arg.length - suffix.length;
  if (paddingLength > 0) {
    padding = replicate(paddingLength, op.zeroPad ? '0' : ' ');
  }
  if (op.leftJustify) {
    // Left-justify by adding the padding to the right.
    return sign + prefix + arg + suffix + padding;
  }
  if (op.zeroPad) {
    // When zero-padding, output the sign and prefix before the padding;
    return sign + prefix + padding + arg + suffix;
  }
  // Right-justify by adding whitespace to the left.
  return padding + sign + prefix + arg + suffix;
}

/*
TODO: write a test suite

!function () {
  const state = C.start({decls: []});

  const fmtVal = C.stringValue('>%f<');
  const fmtRef = new C.PointerValue(C.pointerType(C.scalarTypes['char']), 0);
  state.memory = C.writeValue(state.memory, fmtRef, fmtVal);

  const int = C.scalarTypes['int'];
  const val = new C.FloatingValue(int, 3.3);

  console.log(sprintf(state, [null, fmtRef, val]));

}();
*/