inp => {
    let tmp = {}
    tmp[0] ??= { }
    tmp[1] = inp['udf']['split']('\\n')(inp['input'])
    tmp[2] ??= {}
    tmp[2]['curr'] ??= {} //
    tmp[4] ??= {}
    tmp[4]['curr'] ??= {} //
    tmp[6] ??= {}
    tmp[6]['curr'] ??= {} //
    tmp[8] ??= {}
    tmp[8]['curr'] ??= {} //
    tmp[10] ??= {}
    tmp[10]['curr'] ??= {} //
    tmp[13] ??= {}
    tmp[13]['curr'] ??= []
    tmp[14] ??= {}
    tmp[14]['curr'] ??= []
    tmp[15] ??= {}
    tmp[15]['curr'] ??= []
    tmp[16] ??= {}
    tmp[16]['curr'] ??= []
    tmp[17] ??= {}
    tmp[17]['curr'] ??= []
    tmp[19] ??= {}
    tmp[19]['direction'] ??= []
    tmp[20] ??= {}
    tmp[20]['direction'] ??= []
    tmp[21] ??= {}
    tmp[21]['direction'] ??= []
    tmp[22] ??= {}
    tmp[22]['direction'] ??= []
    tmp[23] ??= {}
    tmp[23]['direction'] ??= []
    for (let KEY_star_line in tmp[1]) {
        tmp[2]['curr'][KEY_star_line] = inp['udf']['split']('')(tmp[1][KEY_star_line])
        tmp[4]['curr'][KEY_star_line] = inp['udf']['split']('')(tmp[1][KEY_star_line])
        tmp[6]['curr'][KEY_star_line] = inp['udf']['split']('')(tmp[1][KEY_star_line])
        tmp[8]['curr'][KEY_star_line] = inp['udf']['split']('')(tmp[1][KEY_star_line])
        tmp[10]['curr'][KEY_star_line] = inp['udf']['split']('')(tmp[1][KEY_star_line])
    }
    tmp[3] ??= {}
    tmp[5] ??= {}
    tmp[7] ??= {}
    tmp[9] ??= {}
    tmp[11] ??= {}
    for (let KEY_star_curr in inp['state']['curr']) {
        if (inp['state']['direction'][KEY_star_curr] === undefined) continue
        tmp[3][KEY_star_curr] ??= {}
        tmp[3][KEY_star_curr][KEY_star_curr] = inp['udf']['filter'](inp['udf']['isEqual']('.',inp['udf']['optionalChaining'](inp['udf']['optionalChaining'](tmp[2]['curr'],inp['state']['curr'][KEY_star_curr][0]),inp['state']['curr'][KEY_star_curr][1])))
        tmp[5][KEY_star_curr] ??= {}
        tmp[5][KEY_star_curr][KEY_star_curr] = inp['udf']['filter'](inp['udf']['isEqual']('|',inp['udf']['optionalChaining'](inp['udf']['optionalChaining'](tmp[4]['curr'],inp['state']['curr'][KEY_star_curr][0]),inp['state']['curr'][KEY_star_curr][1])))
        tmp[7][KEY_star_curr] ??= {}
        tmp[7][KEY_star_curr][KEY_star_curr] = inp['udf']['filter'](inp['udf']['isEqual']('-',inp['udf']['optionalChaining'](inp['udf']['optionalChaining'](tmp[6]['curr'],inp['state']['curr'][KEY_star_curr][0]),inp['state']['curr'][KEY_star_curr][1])))
        tmp[9][KEY_star_curr] ??= {}
        tmp[9][KEY_star_curr][KEY_star_curr] = inp['udf']['filter'](inp['udf']['isEqual']('/',inp['udf']['optionalChaining'](inp['udf']['optionalChaining'](tmp[8]['curr'],inp['state']['curr'][KEY_star_curr][0]),inp['state']['curr'][KEY_star_curr][1])))
        tmp[11][KEY_star_curr] ??= {}
        tmp[11][KEY_star_curr][KEY_star_curr] = inp['udf']['filter'](inp['udf']['isEqual']('\\',inp['udf']['optionalChaining'](inp['udf']['optionalChaining'](tmp[10]['curr'],inp['state']['curr'][KEY_star_curr][0]),inp['state']['curr'][KEY_star_curr][1])))
        for (let KEY_star_fDot in tmp[3][KEY_star_curr][KEY_star_curr]) {
            tmp[13]['curr'] .push (inp['udf']['dotNext'](inp['udf']['andThen'](tmp[3][KEY_star_curr][KEY_star_curr][KEY_star_fDot],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
            tmp[19]['direction'] .push (inp['udf']['dotDirection'](inp['udf']['andThen'](tmp[3][KEY_star_curr][KEY_star_curr][KEY_star_fDot],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
        }
        for (let KEY_star_fPipe in tmp[5][KEY_star_curr][KEY_star_curr]) {
            tmp[14]['curr'] .push (inp['udf']['pipeNext'](inp['udf']['andThen'](tmp[5][KEY_star_curr][KEY_star_curr][KEY_star_fPipe],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
            tmp[20]['direction'] .push (inp['udf']['pipeDirection'](inp['udf']['andThen'](tmp[5][KEY_star_curr][KEY_star_curr][KEY_star_fPipe],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
        }
        for (let KEY_star_fDash in tmp[7][KEY_star_curr][KEY_star_curr]) {
            tmp[15]['curr'] .push (inp['udf']['dashNext'](inp['udf']['andThen'](tmp[7][KEY_star_curr][KEY_star_curr][KEY_star_fDash],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
            tmp[21]['direction'] .push (inp['udf']['dashDirection'](inp['udf']['andThen'](tmp[7][KEY_star_curr][KEY_star_curr][KEY_star_fDash],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
        }
        for (let KEY_star_fSlash in tmp[9][KEY_star_curr][KEY_star_curr]) {
            tmp[16]['curr'] .push (inp['udf']['slashNext'](inp['udf']['andThen'](tmp[9][KEY_star_curr][KEY_star_curr][KEY_star_fSlash],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
            tmp[22]['direction'] .push (inp['udf']['slashDirection'](inp['udf']['andThen'](tmp[9][KEY_star_curr][KEY_star_curr][KEY_star_fSlash],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
        }
        for (let KEY_star_fBackslash in tmp[11][KEY_star_curr][KEY_star_curr]) {
            tmp[17]['curr'] .push (inp['udf']['backslashNext'](inp['udf']['andThen'](tmp[11][KEY_star_curr][KEY_star_curr][KEY_star_fBackslash],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
            tmp[23]['direction'] .push (inp['udf']['backslashDirection'](inp['udf']['andThen'](tmp[11][KEY_star_curr][KEY_star_curr][KEY_star_fBackslash],inp['state']['curr'][KEY_star_curr]),inp['state']['direction'][KEY_star_curr]))
        }
    }
    tmp[12] ??= {}
    tmp[12]['curr'] = [tmp[13]['curr'],tmp[14]['curr'],tmp[15]['curr'],tmp[16]['curr'],tmp[17]['curr']].flat()
    tmp[18] ??= {}
    tmp[18]['direction'] = [tmp[19]['direction'],tmp[20]['direction'],tmp[21]['direction'],tmp[22]['direction'],tmp[23]['direction']].flat()
    tmp[0]['curr'] = inp['udf']['flat'](tmp[12]['curr'])
    tmp[0]['direction'] = inp['udf']['flat'](tmp[18]['direction'])
    return tmp[0]
}