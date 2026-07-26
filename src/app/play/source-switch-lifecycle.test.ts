import { readFileSync } from 'fs';
import path from 'path';

describe('play page source switch lifecycle', () => {
  it('keeps source switching separate from PlayRecord deletion', () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), 'src/app/play/page.tsx'),
      'utf8',
    );
    const switchStart = pageSource.indexOf('const handleSourceChange = async');
    const switchEnd = pageSource.indexOf('const handleEpisodeChange = async');
    const handleSourceChange = pageSource.slice(switchStart, switchEnd);

    expect(switchStart).toBeGreaterThanOrEqual(0);
    expect(switchEnd).toBeGreaterThan(switchStart);
    expect(handleSourceChange).toContain('sessionStorage.setItem');
    expect(handleSourceChange).toContain('temp_progress_');
    expect(handleSourceChange).toContain('pendingSourceSwitchRef.current');
    expect(handleSourceChange).toContain('candidateSnapshot');
    expect(handleSourceChange).toContain('rollbackPendingSourceSwitch');
    expect(handleSourceChange).not.toContain('deletePlayRecord');
  });

  it('saves progress with active identity while a candidate source is pending', () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), 'src/app/play/page.tsx'),
      'utf8',
    );
    const saveStart = pageSource.indexOf('const saveCurrentPlayProgress = async');
    const saveEnd = pageSource.indexOf('useEffect(() => {', saveStart);
    const saveProgress = pageSource.slice(saveStart, saveEnd);

    expect(saveStart).toBeGreaterThanOrEqual(0);
    expect(saveEnd).toBeGreaterThan(saveStart);
    expect(saveProgress).toContain('pendingSourceSwitchRef.current?.active');
    expect(saveProgress).toContain('progressSnapshot.source');
    expect(saveProgress).toContain('progressSnapshot.id');
    expect(saveProgress).not.toContain('source: currentSourceRef.current');
    expect(saveProgress).not.toContain('id: currentIdRef.current');
  });

  it('commits candidate only after player switch success or ready/canplay', () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), 'src/app/play/page.tsx'),
      'utf8',
    );

    expect(pageSource).toContain('const commitPendingSourceSwitch');
    expect(pageSource).toContain('commitPendingSourceSwitch();');
    expect(pageSource).toContain("artPlayerRef.current.on('ready'");
    expect(pageSource).toContain("artPlayerRef.current.on('video:canplay'");
    expect(pageSource).toContain("artPlayerRef.current.on('error'");
    expect(pageSource).toContain('rollbackPendingSourceSwitch(err)');
  });
});
