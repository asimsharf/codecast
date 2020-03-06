/*     1 */
$compiledmod = function() {
    var $scope146 = (function($forcegbl) {
        var $loadname180, $loadname180, $lsubscr182, $loadname183, $loadname183, $lsubscr184, $loadname183, $lsubscr184, $lsubscr185, $loadname183, $lsubscr184, $lsubscr185;
        var $wakeFromSuspension = function() {
            var susp = $scope146.$wakingSuspension;
            $scope146.$wakingSuspension = undefined;
            $blk = susp.$blk;
            $loc = susp.$loc;
            $gbl = susp.$gbl;
            $exc = susp.$exc;
            $err = susp.$err;
            $postfinally = susp.$postfinally;
            $currLineNo = susp.$lineno;
            $currColNo = susp.$colno;
            Sk.lastYield = Date.now();
            $loadname180 = susp.$tmps.$loadname180;
            $lsubscr182 = susp.$tmps.$lsubscr182;
            $loadname183 = susp.$tmps.$loadname183;
            $lsubscr184 = susp.$tmps.$lsubscr184;
            $lsubscr185 = susp.$tmps.$lsubscr185;
            try {
                $ret = susp.child.resume();
            } catch (err) {
                if (!(err instanceof Sk.builtin.BaseException)) {
                    err = new Sk.builtin.ExternalError(err);
                }
                err.traceback.push({
                    lineno: $currLineNo,
                    colno: $currColNo,
                    filename: '<stdin>.py'
                });
                if ($exc.length > 0) {
                    $err = err;
                    $blk = $exc.pop();
                } else {
                    throw err;
                }
            }
        };
        var $saveSuspension = function($child, $filename, $lineno, $colno) {
            var susp = new Sk.misceval.Suspension();
            susp.child = $child;
            susp.resume = function() {
                $scope146.$wakingSuspension = susp;
                return $scope146();
            };
            susp.data = susp.child.data;
            susp.$blk = $blk;
            susp.$loc = $loc;
            susp.$gbl = $gbl;
            susp.$exc = $exc;
            susp.$err = $err;
            susp.$postfinally = $postfinally;
            susp.$filename = $filename;
            susp.$lineno = $lineno;
            susp.$colno = $colno;
            susp.optional = susp.child.optional;
            susp.$tmps = {
                "$loadname180": $loadname180,
                "$lsubscr182": $lsubscr182,
                "$loadname183": $loadname183,
                "$lsubscr184": $lsubscr184,
                "$lsubscr185": $lsubscr185
            };
            return susp;
        };
        var $gbl = $forcegbl || {},
            $blk = 0,
            $exc = [],
            $loc = $gbl,
            $cell = {},
            $err = undefined;
        $loc.__file__ = new Sk.builtins.str('<stdin>.py');
        var $ret = undefined,
            $postfinally = undefined,
            $currLineNo = undefined,
            $currColNo = undefined;
        if ($scope146.$wakingSuspension !== undefined) {
            $wakeFromSuspension();
        }
        if (Sk.retainGlobals) {
            if (Sk.globals) {
                $gbl = Sk.globals;
                Sk.globals = $gbl;
                $loc = $gbl;
            }
            if (Sk.globals) {
                $gbl = Sk.globals;
                Sk.globals = $gbl;
                $loc = $gbl;
                $loc.__file__ = new Sk.builtins.str('<stdin>.py');
            } else {
                Sk.globals = $gbl;
            }
        } else {
            Sk.globals = $gbl;
        }
        while (true) {
            try {
                switch ($blk) {
                    case 0:
                        /* --- module entry --- */ if (Sk.breakpoints('<stdin>.py', 1, 0)) {
                        var $susp = $saveSuspension({
                            data: {
                                type: 'Sk.debug'
                            },
                            resume: function() {}
                        }, '<stdin>.py', 1, 0);
                        $susp.$blk = 1;
                        $susp.optional = true;
                        return $susp;
                    }
                        $blk = 1; /* allowing case fallthrough */
                    case 1:
                        /* --- debug breakpoint for line 1 --- */
                        /*     2 */ //
                        /*     3 */ // line 1:
                        /*     4 */ // Array2D = [[11, 12, 5, 2], [15, 6,10], [10, 8, 12, 5], [12,15,8,6]]
                        /*     5 */ // ^
                        /*     6 */ //
                        /*     7 */
                        $currLineNo = 1;
                        /*     8 */
                        $currColNo = 0;
                        /*     9 */
                        /*    10 */
                        var $elem148 = $scope146.$const147;
                        console.log('$elem148 =', $elem148);
                        var $elem150 = $scope146.$const149;
                        console.log('$elem150 =', $elem150);
                        var $elem152 = $scope146.$const151;
                        console.log('$elem152 =', $elem152);
                        var $elem154 = $scope146.$const153;
                        console.log('$elem154 =', $elem154);
                        var $loadlist155 = new Sk.builtins['list']([$elem148, $elem150, $elem152, $elem154]);
                        console.log('$loadlist155 =', $loadlist155);
                        var $elem156 = $loadlist155;
                        console.log('$elem156 =', $elem156);
                        var $elem158 = $scope146.$const157;
                        console.log('$elem158 =', $elem158);
                        var $elem160 = $scope146.$const159;
                        console.log('$elem160 =', $elem160);
                        var $elem162 = $scope146.$const161;
                        console.log('$elem162 =', $elem162);
                        var $loadlist163 = new Sk.builtins['list']([$elem158, $elem160, $elem162]);
                        console.log('$loadlist163 =', $loadlist163);
                        var $elem164 = $loadlist163;
                        console.log('$elem164 =', $elem164);
                        var $elem165 = $scope146.$const161;
                        console.log('$elem165 =', $elem165);
                        var $elem167 = $scope146.$const166;
                        console.log('$elem167 =', $elem167);
                        var $elem168 = $scope146.$const149;
                        console.log('$elem168 =', $elem168);
                        var $elem169 = $scope146.$const151;
                        console.log('$elem169 =', $elem169);
                        var $loadlist170 = new Sk.builtins['list']([$elem165, $elem167, $elem168, $elem169]);
                        console.log('$loadlist170 =', $loadlist170);
                        var $elem171 = $loadlist170;
                        console.log('$elem171 =', $elem171);
                        var $elem172 = $scope146.$const149;
                        console.log('$elem172 =', $elem172);
                        var $elem173 = $scope146.$const157;
                        console.log('$elem173 =', $elem173);
                        var $elem174 = $scope146.$const166;
                        console.log('$elem174 =', $elem174);
                        var $elem175 = $scope146.$const159;
                        console.log('$elem175 =', $elem175);
                        var $loadlist176 = new Sk.builtins['list']([$elem172, $elem173, $elem174, $elem175]);
                        console.log('$loadlist176 =', $loadlist176);
                        var $elem177 = $loadlist176;
                        console.log('$elem177 =', $elem177);
                        var $loadlist178 = new Sk.builtins['list']([$elem156, $elem164, $elem171, $elem177]);
                        console.log('$loadlist178 =', $loadlist178);
                        $loc.Array2D = window.currentPythonRunner.reportValue($loadlist178, '$loc.Array2D');
                        if (Sk.breakpoints('<stdin>.py', 3, 0)) {
                            var $susp = $saveSuspension({
                                data: {
                                    type: 'Sk.debug'
                                },
                                resume: function() {}
                            }, '<stdin>.py', 3, 0);
                            $susp.$blk = 2;
                            $susp.optional = true;
                            return $susp;
                        }
                        $blk = 2; /* allowing case fallthrough */
                    case 2:
                        /* --- debug breakpoint for line 3 --- */
                        /*    11 */ //
                        /*    12 */ // line 3:
                        /*    13 */ // Array2D[1][2] = 46
                        /*    14 */ // ^
                        /*    15 */ //
                        /*    16 */
                        $currLineNo = 3;
                        /*    17 */
                        $currColNo = 0;
                        /*    18 */
                        /*    19 */
                        var $loadname180 = $loc.Array2D !== undefined ? $loc.Array2D : Sk.misceval.loadname('Array2D', $gbl);;
                        console.log('$loadname180 =', $loadname180);
                        $ret = Sk.abstr.objectGetItem($loadname180, $scope146.$const181, true);
                        $blk = 3; /* allowing case fallthrough */
                    case 3:
                        /* --- function return or resume suspension --- */ if ($ret && $ret.$isSuspension) {
                        console.log('saveSuspension');
                        return $saveSuspension($ret, '<stdin>.py', $currLineNo, $currColNo);
                    }
                        var $lsubscr182 = $ret;
                        console.log('$lsubscr182 =', $lsubscr182);
                        $ret = Sk.abstr.objectSetItem($lsubscr182, $scope146.$const153, $scope146.$const179, true);
                        $blk = 4; /* allowing case fallthrough */
                    case 4:
                        /* --- function return or resume suspension --- */ if ($ret && $ret.$isSuspension) {
                        console.log('saveSuspension');
                        return $saveSuspension($ret, '<stdin>.py', $currLineNo, $currColNo);
                    }
                        if (Sk.breakpoints('<stdin>.py', 4, 0)) {
                            var $susp = $saveSuspension({
                                data: {
                                    type: 'Sk.debug'
                                },
                                resume: function() {}
                            }, '<stdin>.py', 4, 0);
                            $susp.$blk = 5;
                            $susp.optional = true;
                            return $susp;
                        }
                        $blk = 5; /* allowing case fallthrough */
                    case 5:
                        /* --- debug breakpoint for line 4 --- */
                        /*    20 */ //
                        /*    21 */ // line 4:
                        /*    22 */ // print Array2D[1][1]
                        /*    23 */ // ^
                        /*    24 */ //
                        /*    25 */
                        $currLineNo = 4;
                        /*    26 */
                        $currColNo = 0;
                        /*    27 */
                        /*    28 */
                        var $loadname183 = $loc.Array2D !== undefined ? $loc.Array2D : Sk.misceval.loadname('Array2D', $gbl);;
                        console.log('$loadname183 =', $loadname183);
                        $ret = Sk.abstr.objectGetItem($loadname183, $scope146.$const181, true);
                        $blk = 6; /* allowing case fallthrough */
                    case 6:
                        /* --- function return or resume suspension --- */ if ($ret && $ret.$isSuspension) {
                        console.log('saveSuspension');
                        return $saveSuspension($ret, '<stdin>.py', $currLineNo, $currColNo);
                    }
                        var $lsubscr184 = $ret;
                        console.log('$lsubscr184 =', $lsubscr184);
                        $ret = Sk.abstr.objectGetItem($lsubscr184, $scope146.$const181, true);
                        $blk = 7; /* allowing case fallthrough */
                    case 7:
                        /* --- function return or resume suspension --- */ if ($ret && $ret.$isSuspension) {
                        console.log('saveSuspension');
                        return $saveSuspension($ret, '<stdin>.py', $currLineNo, $currColNo);
                    }
                        var $lsubscr185 = $ret;
                        console.log('$lsubscr185 =', $lsubscr185);
                        $ret = Sk.misceval.print_(new Sk.builtins['str']($lsubscr185).v);
                        $blk = 8; /* allowing case fallthrough */
                    case 8:
                        /* --- function return or resume suspension --- */ if ($ret && $ret.$isSuspension) {
                        console.log('saveSuspension');
                        return $saveSuspension($ret, '<stdin>.py', 4, 0);
                    }
                        $ret = Sk.misceval.print_("\n");
                        $blk = 9; /* allowing case fallthrough */
                    case 9:
                        /* --- function return or resume suspension --- */ if ($ret && $ret.$isSuspension) {
                        console.log('saveSuspension');
                        return $saveSuspension($ret, '<stdin>.py', 4, 0);
                    }
                        console.log('cmod ast return');
                        return $loc;
                        throw new Sk.builtin.SystemError('internal error: unterminated block');
                }
            } catch (err) {
                if (!(err instanceof Sk.builtin.BaseException)) {
                    err = new Sk.builtin.ExternalError(err);
                }
                err.traceback.push({
                    lineno: $currLineNo,
                    colno: $currColNo,
                    filename: '<stdin>.py'
                });
                if ($exc.length > 0) {
                    $err = err;
                    $blk = $exc.pop();
                    continue;
                } else {
                    throw err;
                }
            }
        }
    });
    $scope146.$const147 = new Sk.builtin.int_(11);
    $scope146.$const149 = new Sk.builtin.int_(12);
    $scope146.$const151 = new Sk.builtin.int_(5);
    $scope146.$const153 = new Sk.builtin.int_(2);
    $scope146.$const157 = new Sk.builtin.int_(15);
    $scope146.$const159 = new Sk.builtin.int_(6);
    $scope146.$const161 = new Sk.builtin.int_(10);
    $scope146.$const166 = new Sk.builtin.int_(8);
    $scope146.$const179 = new Sk.builtin.int_(46);
    $scope146.$const181 = new Sk.builtin.int_(1);
    /*    29 */
    return $scope146;
}();
