#!/usr/bin/env python3
"""Capture sanitized shard3 room layouts using GET only; never deploy or write Memory.

Fresh variants are explicit test reductions of the corresponding live layout:
identical encoded terrain, a level-1 controller, all sources/minerals, and the
lexicographically lowest-ID built spawn. They are not claimed to be live rooms.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import time
import urllib.parse

# Importing the approved helper must not create files in the live code directory.
sys.dont_write_bytecode = True
DEPLOY = pathlib.Path(
    '/Users/liaowang/Library/Application Support/Screeps/scripts/screeps.com/deploy_screeps.py'
)
OUTPUT = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'base-builder'
ROOMS = ('E9S18', 'E9S19', 'E7S18')
SHARD = 'shard3'
LAYOUT_TYPES = frozenset({
    'controller', 'source', 'mineral', 'constructionSite', 'spawn', 'extension',
    'road', 'constructedWall', 'rampart', 'keeperLair', 'portal', 'link',
    'storage', 'tower', 'observer', 'powerBank', 'powerSpawn', 'extractor',
    'lab', 'terminal', 'container', 'nuker', 'factory', 'invaderCore',
})
OBJECT_KEYS = frozenset({'_id', 'type', 'x', 'y', 'level', 'user', 'name', 'structureType'})
FIXTURE_KEYS = frozenset({'room', 'shard', 'variant', 'capturedAt', 'terrain', 'objects', 'livePlan'})


class CaptureError(Exception):
    """Only non-sensitive diagnostics may be passed to this exception."""


def require(condition, message):
    if not condition:
        raise CaptureError(message)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def load_helper():
    spec = importlib.util.spec_from_file_location('approved_screeps_deploy', DEPLOY)
    if spec is None or spec.loader is None:
        raise CaptureError('approved helper unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def decode_memory(data):
    if isinstance(data, str) and data.startswith('gz:'):
        data = gzip.decompress(base64.b64decode(data[3:])).decode('utf-8')
    if isinstance(data, str):
        return json.loads(data)
    return data


def sanitize_objects(raw):
    require(isinstance(raw, list), 'room objects response is not a list')
    result = []
    for obj in raw:
        require(isinstance(obj, dict), 'malformed room object')
        if obj.get('type') not in LAYOUT_TYPES:
            continue  # creeps, power creeps, drops, ruins, tombstones, etc.
        clean = {key: obj[key] for key in OBJECT_KEYS if key in obj}
        require(all(key in clean for key in ('_id', 'type', 'x', 'y')), 'incomplete layout object')
        require(isinstance(clean['_id'], str) and bool(clean['_id']), 'invalid object ID')
        require(all(type(clean[axis]) is int and 0 <= clean[axis] < 50 for axis in ('x', 'y')),
                'invalid object coordinates')
        if 'level' in clean:
            require(type(clean['level']) is int, 'invalid object level')
        for key in ('user', 'name', 'structureType'):
            if key in clean:
                require(isinstance(clean[key], str), 'invalid layout string property')
        if clean['type'] == 'constructionSite':
            require(clean.get('structureType') in LAYOUT_TYPES, 'unknown construction type')
        result.append(clean)
    result.sort(key=lambda obj: (obj['_id'], obj['type']))
    require(len({obj['_id'] for obj in result}) == len(result), 'duplicate layout IDs')
    require(sum(obj['type'] == 'controller' for obj in result) == 1, 'expected one controller')
    require(any(obj['type'] == 'source' for obj in result), 'no source returned')
    require(any(obj['type'] == 'mineral' for obj in result), 'no mineral returned')
    require(any(obj['type'] == 'spawn' for obj in result), 'no built spawn returned')
    return result


def fresh_variant(existing):
    lowest_spawn = min(obj['_id'] for obj in existing['objects'] if obj['type'] == 'spawn')
    objects = []
    for obj in existing['objects']:
        if obj['type'] in ('controller', 'source', 'mineral') or obj['_id'] == lowest_spawn:
            obj = dict(obj)
            if obj['type'] == 'controller':
                obj['level'] = 1
            objects.append(obj)
    return dict(existing, variant='fresh', objects=objects, livePlan=None)


def verify_fixture(fixture, room, variant):
    require(isinstance(fixture, dict) and set(fixture) == FIXTURE_KEYS, 'invalid fixture keys')
    require(fixture['room'] == room and fixture['shard'] == SHARD, 'fixture identity mismatch')
    require(fixture['variant'] == variant, 'fixture variant mismatch')
    require(isinstance(fixture['capturedAt'], str), 'missing capture timestamp')
    datetime.fromisoformat(fixture['capturedAt'].replace('Z', '+00:00'))
    terrain = fixture['terrain']
    require(isinstance(terrain, str) and len(terrain) == 2500 and set(terrain) <= set('0123'),
            'terrain must be 2500 encoded characters (0/1/2/3)')
    objects = fixture['objects']
    require(objects == sanitize_objects(objects), 'objects not sanitized/sorted')
    require(all(set(obj) <= OBJECT_KEYS for obj in objects), 'unexpected object properties')
    require(fixture['livePlan'] is None or isinstance(fixture['livePlan'], dict), 'invalid live plan')
    return {
        'room': room, 'variant': variant, 'capturedAt': fixture['capturedAt'],
        'objectCount': len(objects), 'types': dict(sorted(Counter(o['type'] for o in objects).items())),
        'siteTypes': dict(sorted(Counter(o['structureType'] for o in objects
                                        if o['type'] == 'constructionSite').items())),
        'terrainLength': len(terrain), 'terrainCounts': dict(sorted(Counter(terrain).items())),
        'terrainSha256': hashlib.sha256(terrain.encode()).hexdigest(),
        'livePlanEntries': len(fixture['livePlan'].get('entries', [])) if fixture['livePlan'] else None,
    }


def verify_room(room):
    existing_path, fresh_path = OUTPUT / f'{room}.json', OUTPUT / f'{room}.fresh.json'
    existing = json.loads(existing_path.read_text())
    fresh = json.loads(fresh_path.read_text())
    reports = [verify_fixture(existing, room, 'existing'), verify_fixture(fresh, room, 'fresh')]
    require(fresh == fresh_variant(existing), 'fresh variant differs from specified reduction')
    for report, path in zip(reports, (existing_path, fresh_path)):
        report['path'] = str(path.relative_to(OUTPUT.parent.parent.parent))
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rooms', choices=ROOMS, nargs='+', default=list(ROOMS))
    parser.add_argument('--without-live-plan', action='store_true')
    parser.add_argument('--verify-only', action='store_true', help='validate local fixtures, without API calls')
    args = parser.parse_args()
    require(len(set(args.rooms)) == len(args.rooms), 'duplicate requested rooms')
    report = {'shard': SHARD, 'methods': [], 'api': [], 'fixtures': [], 'failures': []}
    if args.verify_only:
        for room in args.rooms:
            report['fixtures'].extend(verify_room(room))
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0

    helper = load_helper()
    # The approved helper handles temporary restricted curl configuration cleanup;
    # neither credentials nor response headers/raw responses are persisted here.
    try:
        token = helper.get_token(helper.DEFAULT_ACCOUNT, helper.DEFAULT_SERVICE, helper.DEFAULT_KEYCHAIN)
    except (Exception, SystemExit):
        raise CaptureError('Keychain credential lookup failed; no fixtures synthesized') from None

    def get(endpoint, params):
        path = endpoint + '?' + urllib.parse.urlencode(params)
        for attempt in range(3):
            try:
                status, data, _headers = helper.curl_json(method='GET', url=helper.API_BASE + path, token=token)
            except (Exception, SystemExit) as error:
                # Never print the helper exception: it can include API bodies.
                text = str(error)
                status_match = re.search(r'status=(\d+)', text)
                status = int(status_match.group(1)) if status_match else 0
                report['api'].append({'method': 'GET', 'path': path, 'status': status, 'ok': False})
                if status == 429 and attempt < 2:
                    retry = re.search(r'retry after\s+(\d+)ms', text, re.I)
                    delay = int(retry.group(1)) / 1000 + 1 if retry else 15 * (attempt + 1)
                    if delay <= 120:
                        time.sleep(delay)
                        continue
                raise CaptureError(f'GET {endpoint} failed (HTTP {status}); no response body retained') from None
            ok = status == 200 and isinstance(data, dict) and data.get('ok') == 1
            report['api'].append({'method': 'GET', 'path': path, 'status': status, 'ok': ok})
            require(ok, f'GET {endpoint} was not HTTP 200 / ok=1')
            return data
        raise CaptureError('GET retry limit reached')

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for room in args.rooms:
        try:
            terrain_response = get('/api/game/room-terrain', {'room': room, 'shard': SHARD, 'encoded': 1})
            records = terrain_response.get('terrain')
            if not isinstance(records, list):
                raise CaptureError('terrain response missing records')
            matches = [item for item in records if isinstance(item, dict) and item.get('room') == room]
            require(len(matches) == 1, 'terrain room identity mismatch')
            terrain = matches[0].get('terrain')
            objects_response = get('/api/game/room-objects', {'room': room, 'shard': SHARD})
            objects = sanitize_objects(objects_response.get('objects'))
            captured_at = utc_now()
            plan = None
            if not args.without_live_plan:
                try:
                    memory = get('/api/user/memory', {'path': f'rooms.{room}.baseBuilder.plan', 'shard': SHARD})
                    plan = decode_memory(memory.get('data'))
                    require(plan is None or isinstance(plan, dict), 'room plan response is not an object/null')
                except (CaptureError, ValueError, OSError, EOFError):
                    report['failures'].append({'room': room, 'optionalLivePlan': 'unavailable; stored null'})
                    plan = None
            existing = {'room': room, 'shard': SHARD, 'variant': 'existing', 'capturedAt': captured_at,
                        'terrain': terrain, 'objects': objects, 'livePlan': plan}
            fresh = fresh_variant(existing)
            verify_fixture(existing, room, 'existing')
            verify_fixture(fresh, room, 'fresh')
            for suffix, fixture in (('', existing), ('.fresh', fresh)):
                (OUTPUT / f'{room}{suffix}.json').write_text(json.dumps(fixture, indent=2, sort_keys=True) + '\n')
            report['fixtures'].extend(verify_room(room))
        except CaptureError as error:
            report['failures'].append({'room': room, 'captureError': str(error)})
        time.sleep(1)
    report['methods'] = sorted({item['method'] for item in report['api']})
    report['verifiedFixtureCount'] = len(report['fixtures'])
    report['expectedFixtureCount'] = len(args.rooms) * 2
    serialized = json.dumps(report, indent=2, sort_keys=True) + '\n'
    (OUTPUT / 'capture-results.txt').write_text(serialized)
    print(serialized, end='')
    return 0 if report['verifiedFixtureCount'] == report['expectedFixtureCount'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except CaptureError as error:
        print(f'Capture blocked: {error}', file=sys.stderr)
        raise SystemExit(1) from None
