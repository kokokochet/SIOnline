import reducer, {
    SIQuesterState,
    bulkCompressionStarted,
    bulkCompressionProgress,
} from '../../src/state/siquesterSlice';
import { createDefaultPackage } from '../../src/model/siquester/packageGenerator';
import JSZip from 'jszip';
import { selectPackageViewSlice } from '../../src/components/siquester/PackageView/PackageView';

function makeState(): SIQuesterState {
    return {
        zip: new JSZip(),
        pack: createDefaultPackage({
            packageName: '',
            authorName: '',
            roundCount: 1,
            themeCount: 1,
            questionCount: 1,
            includeFinalRound: false,
            finalThemeCount: 0,
        }),
        packageStats: undefined,
        packageTopLevelStats: undefined,
        packageStatsLoading: false,
        showPackageStats: false,
        isNewPackage: false,
        history: { past: [], future: [] },
        zipRevision: 0,
    } as SIQuesterState;
}

test('selectPackageViewSlice: every field is === across a bulkCompressionProgress tick', () => {
    let state: SIQuesterState = makeState();
    state = reducer(state, bulkCompressionStarted({ total: 10 }));

    const before = selectPackageViewSlice({ siquester: state });

    state = reducer(state, bulkCompressionProgress({ completed: 1, currentFile: 'a.png' }));

    const after = selectPackageViewSlice({ siquester: state });

    expect(after.zip).toBe(before.zip);
    expect(after.pack).toBe(before.pack);
    expect(after.packageStats).toBe(before.packageStats);
    expect(after.packageTopLevelStats).toBe(before.packageTopLevelStats);
    expect(after.packageStatsLoading).toBe(before.packageStatsLoading);
    expect(after.showPackageStats).toBe(before.showPackageStats);
    expect(after.isNewPackage).toBe(before.isNewPackage);
    expect(after.history).toBe(before.history);
});
