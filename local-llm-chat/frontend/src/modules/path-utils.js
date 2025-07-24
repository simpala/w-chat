// frontend/src/modules/path-utils.js

/**
 * Extracts the filename from a path, regardless of the path separator ('/' or '\').
 * @param {string} path The full path to the file.
 * @returns {string} The name of the file.
 */
export function getModelName(path) {
    if (!path) {
        return '';
    }
    // Replace backslashes with forward slashes for consistency, then split.
    return path.replace(/\\/g, '/').split('/').pop();
}