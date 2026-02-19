import { jest } from '@jest/globals';
import * as path from 'path';
import { truncateContent, ensureAbsolutePath, trackCodebasePath } from '../utils.js';

describe('truncateContent', () => {
    it('should return content unchanged when shorter than maxLength', () => {
        expect(truncateContent('hello', 10)).toBe('hello');
    });

    it('should return content unchanged when exactly maxLength', () => {
        expect(truncateContent('hello', 5)).toBe('hello');
    });

    it('should truncate and append "..." when content exceeds maxLength', () => {
        expect(truncateContent('hello world', 5)).toBe('hello...');
    });

    it('should handle empty string', () => {
        expect(truncateContent('', 10)).toBe('');
    });
});

describe('ensureAbsolutePath', () => {
    it('should return absolute path unchanged', () => {
        expect(ensureAbsolutePath('/home/user/project')).toBe('/home/user/project');
    });

    it('should resolve relative path to absolute', () => {
        const result = ensureAbsolutePath('some/relative/path');
        expect(path.isAbsolute(result)).toBe(true);
        expect(result).toBe(path.resolve('some/relative/path'));
    });

    it('should resolve "." to current working directory', () => {
        expect(ensureAbsolutePath('.')).toBe(process.cwd());
    });
});

describe('trackCodebasePath', () => {
    let consoleSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('should log the absolute path', () => {
        trackCodebasePath('/some/codebase');
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('/some/codebase')
        );
    });
});
