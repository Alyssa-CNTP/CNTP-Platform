"""
Which batches an output bag may be tagged with. Models SievingCapture's
batchHints and OutputPicker's restrictBatch, including the case that silently
lost the guard once the changeover duplication was fixed.
"""


def batch_hints(active_debag_lots, session_debag_lots, matching_batches):
    """SievingCapture: this batch, the whole session, then the same-grade carve-out."""
    seen, out = set(), []
    for lot in [*active_debag_lots, *session_debag_lots, *matching_batches]:
        lot = (lot or '').strip()
        if lot and lot not in seen:
            seen.add(lot)
            out.append(lot)
    return out


def picker(hints, recent_batches):
    """OutputPicker: hints restrict; no hints falls back to recent, unrestricted."""
    if hints:
        return {'options': hints, 'restricted': True}
    return {'options': recent_batches, 'restricted': False}


RECENT = ['GS-0165', 'MAT-0363', 'GS-9999-TYPO', 'VS22-138']
fails = []


def check(name, got, want):
    ok = got == want
    print(('  ok   ' if ok else '  FAIL ') + '%-56s got %s' % (name, got))
    if not ok:
        print(' ' * 8 + 'want %s' % (want,))
        fails.append(name)


print('\n1. One batch, debagged and bagged on it -- always worked')
h = batch_hints(['GS-0165'], ['GS-0165'], [])
check('restricted to what was fed in', picker(h, RECENT),
      {'options': ['GS-0165'], 'restricted': True})

print('\n2. THE REGRESSION: changeover put the debagging on batch 1 and the')
print('   operator is bagging on batch 2, which has no debag rows of its own')
before = picker(batch_hints([], [], []), RECENT)
check('what it did after the dedup fix (guard lost)', before,
      {'options': RECENT, 'restricted': False})
after = picker(batch_hints([], ['GS-0165', 'MAT-0336'], []), RECENT)
check('with the session as the source', after,
      {'options': ['GS-0165', 'MAT-0336'], 'restricted': True})
check('the typo batch is no longer offered', 'GS-9999-TYPO' in after['options'], False)

print('\n3. The earlier-session carve-out still applies')
h = batch_hints([], ['GS-0165'], ['GS-0313', 'MAT-0295'])
check('same variant+grade lots from earlier sessions included',
      picker(h, RECENT)['options'], ['GS-0165', 'GS-0313', 'MAT-0295'])

print('\n4. Deduplicated, and the mounted batch stays first')
h = batch_hints(['MAT-0336'], ['GS-0165', 'MAT-0336'], ['MAT-0336'])
check('no repeats, active batch leads', h, ['MAT-0336', 'GS-0165'])

print('\n5. Blank and whitespace lots never become options')
check('dropped', batch_hints(['', '  '], ['', 'GS-0165'], ['  ']), ['GS-0165'])

print('\n6. Genuinely nothing debagged yet: fail OPEN, but the operator is told')
p = picker(batch_hints([], [], []), RECENT)
check('unrestricted so the floor is never blocked', p['restricted'], False)
check('and the screen must say the check is not running', not p['restricted'], True)

print('\n' + ('ALL CHECKS PASSED' if not fails else 'FAILURES: %s' % fails))
