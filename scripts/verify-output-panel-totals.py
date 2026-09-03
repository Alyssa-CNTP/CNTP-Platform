"""
Does the Bagging panel add up? Modelled on the 2 September order, where the
header claimed a weight the rows beneath it could not reach.

Total output has two parts:
  bagged out      the bags listed in the panel
  fresh top-ups   weight added TODAY into bags first bagged on an earlier day,
                  so they are not among those bags and never in the bag count
"""


def panel(bags_kg, fresh_topup_kg):
    """What the panel now shows, top to bottom."""
    bagged = sum(bags_kg)
    return {
        'header_bags': len(bags_kg),
        'header_kg': bagged,          # was bagged + top-ups, over a list of bags only
        'rows_sum': bagged,
        'bagged_out': bagged,
        'top_ups': fresh_topup_kg,
        'total_output': bagged + fresh_topup_kg,
    }


fails = []


def check(name, got, want):
    ok = abs(got - want) < 1e-9 if isinstance(got, (int, float)) else got == want
    print(('  ok   ' if ok else '  FAIL ') + '%-54s got %-10s want %s' % (name, round(got, 1) if isinstance(got, float) else got, want))
    if not ok:
        fails.append(name)


print('\n1. 2 September: 292 kg of top-ups into 1 September bags')
# TOTAL OUTPUT on the report was 18 217.0, so the bags themselves are 17 925.0.
p = panel([17925.0], 292.0)
check('header kg equals what the rows sum to', p['header_kg'], p['rows_sum'])
check('header kg is the bags only', p['header_kg'], 17925.0)
check('top-ups shown as their own line', p['top_ups'], 292.0)
check('Total output still the mass-balance figure', p['total_output'], 18217.0)
check('the arithmetic closes', p['bagged_out'] + p['top_ups'], p['total_output'])

print('\n2. What it did before: header asserted a total its rows could not reach')
before_header = 18217.0          # bagsOutputKg
check('gap between header and rows', before_header - 17925.0, 292.0)

print('\n3. No top-ups: the bags total IS the output, and nothing is repeated')
p = panel([300.0, 300.0, 219.0], 0.0)
check('header kg', p['header_kg'], 819.0)
check('total output identical', p['total_output'], 819.0)
check('no extra summing block needed', p['top_ups'] == 0, True)

print('\n4. Top-ups only, nothing bagged that day')
p = panel([], 78.0)
check('no bags', p['header_bags'], 0)
check('header kg 0', p['header_kg'], 0.0)
check('total output is the increment', p['total_output'], 78.0)

print('\n5. A top-up is never counted in the bag COUNT')
p = panel([300.0, 300.0], 22.0)
check('two bags, not three', p['header_bags'], 2)
check('but 622 kg out', p['total_output'], 622.0)

print('\n' + ('ALL CHECKS PASSED' if not fails else 'FAILURES: %s' % fails))
