"""
The rule under test: an output bag's grade follows the grade its LOT was
debagged under, because that is where the grade is actually decided. Checked
against the real 31-08-2026 rows -- the floor's sheet and the order page.
"""


def resolve(bag_lot, tagged, grades_by_lot):
    """Mirrors loadOrderDay: lot wins, unless the lot is mixed or unknown."""
    grades = grades_by_lot.get(bag_lot)
    if not grades:
        return tagged, 'tag'
    if len(grades) > 1:
        return tagged, 'ambiguous'
    only = next(iter(grades))
    return (only, 'lot') if only != tagged else (tagged, 'tag')


# 31-08-2026 debagging, from the floor's sheet. GS-0313 appears under BOTH
# grades that morning (X-1602 Export, 1073 Export Blend).
GRADES = {
    'GS-0107': {'Export'}, 'GS-0299': {'Export'}, 'GS-0206': {'Export'},
    'MAT-0270': {'Export'}, 'GS-0117': {'Export'}, 'GS-0321': {'Export'},
    'MAT-0295': {'Export'}, 'GS-0205': {'Export'},
    'GS-20-238': {'Export Blend'}, 'GS-24-047': {'Export Blend'},
    'GS-22-157': {'Export Blend'}, 'VS22-138': {'Export Blend'},
    'VS22-158': {'Export Blend'}, 'MAT-0240': {'Export Blend'},
    'MAT-0336': {'Export Blend'},
    'GS-0313': {'Export', 'Export Blend'},
    'GS-0168': {'Export'}, 'GS-0165': {'Export'},
}

fails = []


def check(name, got, want):
    ok = got == want
    print(('  ok   ' if ok else '  FAIL ') + '%-52s got %-34s want %s' % (name, got, want))
    if not ok:
        fails.append(name)


print('\n1. The two bags that were wrong on the report')
check('STFL-310826-010 off GS-22-157, tagged Export',
      resolve('GS-22-157', 'Export', GRADES), ('Export Blend', 'lot'))
check('STFL-310826-012 off MAT-0336, tagged Export',
      resolve('MAT-0336', 'Export', GRADES), ('Export Blend', 'lot'))

print('\n2. The one that was already right must not be disturbed')
check('STFL-310826-009 off GS-20-238, tagged Export Blend',
      resolve('GS-20-238', 'Export Blend', GRADES), ('Export Blend', 'tag'))

print('\n3. GS-0313 was debagged as BOTH grades -- nothing can be inferred')
check('STFL-310826-007 off GS-0313, tagged Export',
      resolve('GS-0313', 'Export', GRADES), ('Export', 'ambiguous'))
check('a GS-0313 bag tagged Export Blend keeps that too',
      resolve('GS-0313', 'Export Blend', GRADES), ('Export Blend', 'ambiguous'))

print('\n4. Every correctly-tagged Export bag stays put')
for lot in ['GS-0107', 'GS-0206', 'MAT-0270', 'GS-0117', 'GS-0321', 'GS-0205', 'GS-0165']:
    check('bag off %s tagged Export' % lot, resolve(lot, 'Export', GRADES), ('Export', 'tag'))

print('\n5. A lot not debagged that day: nothing to infer from, tag stands')
check('STFL-310826-011 off MAT-0363 (not on the sheet)',
      resolve('MAT-0363', 'Export', GRADES), ('Export', 'tag'))

print('\n6. An untagged bag off a single-grade lot still gets a grade')
check('no tag, off MAT-0336', resolve('MAT-0336', None, GRADES), ('Export Blend', 'lot'))

print('\n7. The Export Blend output total for 31-08 morning')
# Bags 9, 10 and 12 are the Export Blend ones once the lot rule applies.
bags = [('GS-0107', 'Export', 300), ('GS-0206', 'Export', 300), ('MAT-0270', 'Export', 300),
        ('GS-0117', 'Export', 300), ('GS-0321', 'Export', 300), ('GS-0205', 'Export', 300),
        ('GS-0313', 'Export', 300), ('GS-0313', 'Export', 203),
        ('GS-20-238', 'Export Blend', 300), ('GS-22-157', 'Export', 300),
        ('MAT-0363', 'Export', 300), ('MAT-0336', 'Export', 300)]
blend = sum(kg for lot, tag, kg in bags if resolve(lot, tag, GRADES)[0] == 'Export Blend')
check('Export Blend Fine Leaf out, was 300', blend, 900)

print('\n' + ('ALL CHECKS PASSED' if not fails else 'FAILURES: %s' % fails))
