"""
The order page's per-bag kg rule, checked against the real rows from
20260902_004 on production. Three sources disagree and only one combination
is right:

  bag_tags.weight_kg   the bag NOW: includes same-day top-ups AND any weight
                       the operator corrected after bagging
  creation event       written once, never updated -- so it holds a mistyped
                       weight for ever
  top-up events        one per increment, never rewritten, each belonging to
                       the production day of the session that captured it

Rule under test:  day_kg = bag_tags.weight_kg - sum(increments on LATER days)
"""


def day_kg(tag_now, later_topups):
    return max(0.0, tag_now - sum(later_topups))


fails = []


def check(name, got, want):
    ok = abs(got - want) < 1e-9
    print(('  ok   ' if ok else '  FAIL ') + '%-58s got %-9s want %s' % (name, round(got, 1), want))
    if not ok:
        fails.append(name)


print('\n1. Real top-up cases from production (Sieving) -- the fix must remove'
      '\n   exactly the later increment')
# serial, order_date, tag_now, [(topup_day, kg)], expected
cases = [
    ('STIS-010926-004', '2026-09-01', 252, [('2026-09-02', 22)],  230),
    ('STRB-010926-003', '2026-09-01', 300, [('2026-09-02', 270)],  30),
    ('STBD-310826-003', '2026-08-31', 300, [('2026-09-01', 78)],  222),
    ('STIS-310826-003', '2026-08-31', 252, [('2026-09-01', 144)], 108),
    ('STRB-310826-003', '2026-08-31', 300, [('2026-09-01', 80)],  220),
    ('STIS-280826-005', '2026-08-28', 252, [('2026-08-31', 129)], 123),
    ('STRS-280826-001', '2026-08-28', 166, [('2026-08-31', 43)],  123),
    ('STIS-270826-005', '2026-08-27', 252, [('2026-08-28', 194)],  58),
    ('STBD-250826-004', '2026-08-25', 300, [('2026-08-26', 101)], 199),
]
for serial, d, now, tus, want in cases:
    later = [kg for day, kg in tus if day > d]
    check(serial, day_kg(now, later), want)

print('\n2. The rows that broke the first attempt: weight corrected after'
      '\n   bagging, NO top-up. The bag now is right; the event is not.')
# serial, order_date, tag_now, creation_event_kg, expected  (= tag_now)
corrections = [
    ('25SFCKUN25C-1-10', '2026-08-31', 350,  3505),   # mistyped 350.5
    ('25SFCKUN25C-1-09', '2026-09-01', 200,  350),
    ('25SFCKUN25C-1-24', '2026-08-31', 300,  350),
    ('25SGNAT26C-1-1-06', '2026-08-25', 350, 250),
    ('25SGNAT26C-1-1-11', '2026-08-25', 350, 500),
    ('06-08-26-004',      '2026-08-06', 500, 170),
    ('31-07-26-007',      '2026-07-31', 100, 300),
]
for serial, d, now, ev in corrections:
    # expected == the bag's current weight: no later top-up to subtract, and the
    # creation event's figure is exactly what must NOT be used.
    check('%s (event says %s)' % (serial, ev), day_kg(now, []), now)

print('\n3. A same-day top-up stays counted -- it is already in the bag now')
check('bagged 300 on 01-09, +22 same day', day_kg(322, []), 322)

print('\n4. Nothing is counted twice, and nothing is lost, across two days')
# Bagged 31-08 at 300, topped up 01-09 by 22. bag now = 322.
d31 = day_kg(322, [22])                       # 31-08 order
d01 = 22                                      # 01-09 order, as a freshTopUp
check('31-08 order', d31, 300)
check('01-09 order (fresh top-up)', d01, 22)
check('both days together = the bag now', d31 + d01, 322)

print('\n5. Two later top-ups on different days both come off the original day')
check('bagged 200, +50 on d+1, +30 on d+5, bag now 280', day_kg(280, [50, 30]), 200)

print('\n6. Never negative, however odd the data')
check('bag now 10, later top-ups 99', day_kg(10, [99]), 0)

print('\n7. A bag with no events at all still reports its weight')
check('no events, bag now 300', day_kg(300, []), 300)

print('\n' + ('ALL CHECKS PASSED' if not fails else 'FAILURES: %s' % fails))
