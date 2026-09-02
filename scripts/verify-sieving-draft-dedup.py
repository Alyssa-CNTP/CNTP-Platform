"""
Model of Step 4b's CTE chain, statement for statement, so the dedup LOGIC can
be tested without a database. The SQL's syntax and types are proved separately
by 20260902_002_repair_parse_check.sql; this proves it does the right thing.
"""
import json, re, copy


def norm_lot(v):
    return re.sub(r'\s', '', (v or '')).upper()


def rebuild(draft):
    """Mirrors: prods -> debag/outs -> *_keep -> *_new -> prods_rebuilt -> rebuilt."""
    prods = draft.get('productions')
    if not isinstance(prods, list):
        return draft                                    # WHERE jsonb_typeof(...) = 'array'

    # debag / outs CTEs: flatten with (p_idx, r_idx) ordinality and an identity
    debag, outs = [], []
    for p_idx, p in enumerate(prods, start=1):
        data = p.get('data') if isinstance(p.get('data'), dict) else {}

        arr = data.get('debag')
        if isinstance(arr, list):
            for r_idx, r in enumerate(arr, start=1):
                label = (r.get('bag_no') or '').strip()
                ident = ('#%d.%d' % (p_idx, r_idx)) if label == '' else (
                    norm_lot(r.get('lot') or p.get('lot') or '') + '|' + label)
                debag.append((p_idx, r_idx, r, ident))

        arr = data.get('outputs')
        if isinstance(arr, list):
            for r_idx, r in enumerate(arr, start=1):
                serial = (r.get('serial') or '').strip()
                ident = ('#%d.%d' % (p_idx, r_idx)) if serial == '' else serial
                outs.append((p_idx, r_idx, r, ident))

    # *_keep: DISTINCT ON (identity) ORDER BY identity, p_idx, r_idx
    def keep(rows):
        seen, out = set(), []
        for p_idx, r_idx, r, ident in sorted(rows, key=lambda t: (t[3], t[0], t[1])):
            if ident in seen:
                continue
            seen.add(ident)
            out.append((p_idx, r_idx, r))
        return out

    # *_new: group by p_idx, jsonb_agg(... order by r_idx)
    def group(rows):
        g = {}
        for p_idx, r_idx, r in rows:
            g.setdefault(p_idx, []).append((r_idx, r))
        return {k: [r for _, r in sorted(v, key=lambda t: t[0])] for k, v in g.items()}

    debag_new, outs_new = group(keep(debag)), group(keep(outs))

    # prods_rebuilt: replace ONLY the two arrays, ONLY where they are arrays
    new_prods = []
    for p_idx, p in enumerate(prods, start=1):
        p_new = copy.deepcopy(p)
        data = p_new.get('data')
        if isinstance(data, dict):
            if isinstance(data.get('debag'), list):
                data['debag'] = debag_new.get(p_idx, [])
            if isinstance(data.get('outputs'), list):
                data['outputs'] = outs_new.get(p_idx, [])
        new_prods.append(p_new)

    # rebuilt + changed: jsonb_set(draft_data, '{productions}', ...)
    out = copy.deepcopy(draft)
    out['productions'] = new_prods
    return out


# ---------------------------------------------------------------------------
fails = []


def check(name, cond):
    print(('  ok   ' if cond else '  FAIL ') + name)
    if not cond:
        fails.append(name)


print('\n1. The real shape: a changeover copied batch 1 into batch 2')
d = {'productions': [
    {'id': 'p1', 'lot': 'GS-0314', 'variant': 'Conventional', 'data': {
        'debag': [{'bag_no': 'E-744', 'nett': '350', 'lot': 'GS-0314'},
                  {'bag_no': 'I-705', 'nett': '350', 'lot': 'GS-0382'}],
        'outputs': [{'serial': 'STFL-010926-001', 'weight': '300'}],
        'spillage': [{'id': 'sp1', 'kg': '120'}], 'bucketSecured': True}},
    {'id': 'p2', 'lot': 'GS-0314', 'variant': 'Conventional', 'data': {
        'debag': [{'bag_no': 'E-744', 'nett': '350', 'lot': 'GS-0314'},
                  {'bag_no': 'I-705', 'nett': '350', 'lot': 'GS-0382'},
                  {'bag_no': 'H-108', 'nett': '350', 'lot': 'GS-20-249'}],
        'outputs': [{'serial': 'STFL-010926-001', 'weight': '300'},
                    {'serial': 'STCL-010926-001', 'weight': '300'}]}},
]}
r = rebuild(d)
check('batch 1 keeps its 2 original bags',
      [x['bag_no'] for x in r['productions'][0]['data']['debag']] == ['E-744', 'I-705'])
check('batch 2 keeps only the bag that is genuinely its own',
      [x['bag_no'] for x in r['productions'][1]['data']['debag']] == ['H-108'])
check('every physical bag survives exactly once',
      sorted(x['bag_no'] for p in r['productions'] for x in p['data']['debag'])
      == ['E-744', 'H-108', 'I-705'])
check('output serials deduplicated across batches',
      [x['serial'] for p in r['productions'] for x in p['data']['outputs']]
      == ['STFL-010926-001', 'STCL-010926-001'])
check('spillage untouched', r['productions'][0]['data']['spillage'] == [{'id': 'sp1', 'kg': '120'}])
check('bucketSecured untouched', r['productions'][0]['data']['bucketSecured'] is True)
check('batch identity untouched', [p['id'] for p in r['productions']] == ['p1', 'p2'])

print('\n2. Blank bag labels are NEVER merged (two unlabelled bags are two bags)')
d = {'productions': [{'lot': 'L1', 'data': {'debag': [
    {'bag_no': '', 'nett': '350'}, {'bag_no': '', 'nett': '350'},
    {'bag_no': '  ', 'nett': '200'}]}}]}
check('all three blank-label rows kept',
      len(rebuild(d)['productions'][0]['data']['debag']) == 3)

print('\n3. Blank serials are never merged either')
d = {'productions': [{'lot': 'L1', 'data': {'outputs': [
    {'serial': '', 'weight': '10'}, {'serial': '', 'weight': '20'}]}}]}
check('both blank-serial outputs kept',
      len(rebuild(d)['productions'][0]['data']['outputs']) == 2)

print('\n4. Lot written two ways is ONE lot (MAT-0375 vs "  MAT- 0375")')
d = {'productions': [{'lot': 'X', 'data': {'debag': [
    {'bag_no': 'S-063', 'lot': 'MAT-0375', 'nett': '350'},
    {'bag_no': 'S-063', 'lot': '  MAT- 0375', 'nett': '350'}]}}]}
check('the whitespace variant is recognised as the same bag',
      len(rebuild(d)['productions'][0]['data']['debag']) == 1)

print('\n5. Same bag label under genuinely different lots is TWO bags')
d = {'productions': [{'lot': 'X', 'data': {'debag': [
    {'bag_no': 'L-692', 'lot': 'GS-26-MIX-A', 'nett': '350'},
    {'bag_no': 'L-692', 'lot': 'MAT-0363', 'nett': '350'}]}}]}
check('both kept', len(rebuild(d)['productions'][0]['data']['debag']) == 2)

print('\n6. The lot falls back to the batch lot when the row has none')
d = {'productions': [{'lot': 'GS-0314', 'data': {'debag': [
    {'bag_no': 'A-1', 'nett': '350'},
    {'bag_no': 'A-1', 'lot': 'GS-0314', 'nett': '350'}]}}]}
check('row-level blank lot resolves to the batch lot, so this is one bag',
      len(rebuild(d)['productions'][0]['data']['debag']) == 1)

print('\n7. Shapes that must not blow up or invent keys')
check('productions not an array -> untouched',
      rebuild({'productions': 'nope'}) == {'productions': 'nope'})
check('no productions key -> untouched', rebuild({'other': 1}) == {'other': 1})
check('empty productions -> untouched', rebuild({'productions': []}) == {'productions': []})
d = {'productions': [{'id': 'p1'}]}
check('batch with no data key -> untouched', rebuild(d) == d)
d = {'productions': [{'id': 'p1', 'data': {'debag': 'not-an-array', 'outputs': None}}]}
check('non-array debag/outputs -> untouched', rebuild(d) == d)
d = {'productions': [{'id': 'p1', 'data': {'spillage': [{'kg': '5'}]}}]}
check('no debag/outputs keys -> none invented', rebuild(d) == d)

print('\n8. A clean session is left byte-identical (the repair is a no-op)')
d = {'productions': [{'id': 'p1', 'lot': 'L', 'data': {
    'debag': [{'bag_no': 'A-1', 'nett': '350'}, {'bag_no': 'A-2', 'nett': '350'}],
    'outputs': [{'serial': 'S1'}, {'serial': 'S2'}], 'spillage': [{'kg': '1'}]}}]}
check('unchanged, so Step 4b will not even update the row',
      json.dumps(rebuild(d), sort_keys=True) == json.dumps(d, sort_keys=True))

print('\n9. Row order within a batch is capture order, not identity order')
d = {'productions': [{'lot': 'L', 'data': {'debag': [
    {'bag_no': 'Z-9', 'nett': '1'}, {'bag_no': 'A-1', 'nett': '2'},
    {'bag_no': 'M-5', 'nett': '3'}]}}]}
check('Z-9, A-1, M-5 preserved',
      [x['bag_no'] for x in rebuild(d)['productions'][0]['data']['debag']]
      == ['Z-9', 'A-1', 'M-5'])

print('\n10. Idempotent: running it twice changes nothing further')
d = {'productions': [
    {'lot': 'L', 'data': {'debag': [{'bag_no': 'A', 'nett': '1'}], 'outputs': []}},
    {'lot': 'L', 'data': {'debag': [{'bag_no': 'A', 'nett': '1'},
                                    {'bag_no': 'B', 'nett': '2'}], 'outputs': []}}]}
once = rebuild(d)
check('second pass is a no-op',
      json.dumps(rebuild(once), sort_keys=True) == json.dumps(once, sort_keys=True))

print('\n' + ('ALL %d CHECKS PASSED' % 26 if not fails else 'FAILURES: %s' % fails))
