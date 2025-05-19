import path from 'path';
import fs from 'fs';

let effectiveAppDataPath: string | null = null;

/**
 * Initializes and returns the effective application data path.
 * This function should be called once at the application startup.
 * It determines the path based on APP_BACKEND_DATA_PATH environment variable
 * or defaults to 'app-data-backend' relative to the compiled output's parent directory.
 * It also ensures that this base directory exists.
 */
export const initializeAppDataPath = (): string => {
    if (effectiveAppDataPath) {
        // Already initialized
        return effectiveAppDataPath;
    }

    const providedBackendDataPath = process.env.APP_BACKEND_DATA_PATH;
    // __dirname will be packages/backend/dist/src/config
    // So, ../../.. goes up to packages/backend/
    const defaultBackendDataPath = path.resolve(__dirname, '../../..', 'app-data-backend');

    effectiveAppDataPath = providedBackendDataPath || defaultBackendDataPath;

    console.log(`[AppConfig] Effective application data base path set to: ${effectiveAppDataPath}`);

    if (!fs.existsSync(effectiveAppDataPath)) {
        try {
            fs.mkdirSync(effectiveAppDataPath, { recursive: true });
            console.log(`[AppConfig] Created application data base directory: ${effectiveAppDataPath}`);
        } catch (err) {
            const error = err as NodeJS.ErrnoException;
            console.error(`[AppConfig] CRITICAL: Failed to create application data base directory at ${effectiveAppDataPath}. Error: ${error.message}. Exiting.`);
            process.exit(1); // Fatal error if data directory cannot be created
        }
    }
    return effectiveAppDataPath;
};

/**
 * Returns the initialized effective application data path.
 * Throws an error if initializeAppDataPath has not been called yet.
 */
export const getAppDataPath = (): string => {
    if (!effectiveAppDataPath) {
        // Fallback to initialize if not called, though explicit call is preferred.
        console.warn('[AppConfig] getAppDataPath called before explicit initialization. Attempting to initialize now.');
        return initializeAppDataPath();
    }
    return effectiveAppDataPath;
};

/**
 * Ensures a specific subdirectory within the app data path exists and returns its full path.
 * @param subPath The subdirectory path relative to the app data path (e.g., 'sessions', 'uploads').
 * @returns The full path to the subdirectory.
 */
export const ensureAndGetPathInAppData = (subPath: string): string => {
    const basePath = getAppDataPath(); // Ensures basePath itself is initialized and exists
    const fullPath = path.join(basePath, subPath);

    if (!fs.existsSync(fullPath)) {
        try {
            fs.mkdirSync(fullPath, { recursive: true });
            console.log(`[AppConfig] Ensured sub-directory exists: ${fullPath}`);
        } catch (err) {
            const error = err as NodeJS.ErrnoException;
            // Log an error but don't necessarily exit, depending on the subPath's criticality
            console.error(`[AppConfig] Failed to create sub-directory ${fullPath}. Error: ${error.message}`);
            // Depending on use case, might throw error here
        }
    }
    return fullPath;
};