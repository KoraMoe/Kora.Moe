import URLCleaner from '@backrunner/url-cleaner';

// Create a URL cleaner instance with default filter lists and redirect handling
const urlCleaner = new URLCleaner({
	useDefaultLists: true, // Use default filter lists
	handleRedirects: true, // Enable automatic redirect handling
	redirectTimeout: 5000, // Set timeout for redirect requests to 5 seconds
	enableWASM: true, // Enable WebAssembly for better performance
});

/**
 * Clean links in text
 * @param text Original text containing links to be cleaned
 * @returns Cleaned text
 */
export const cleanLink = async (text: string): Promise<string> => {
	try {
		// Use cleanURLsInText method to directly clean all URLs in the text
		return await urlCleaner.cleanURLsInText(text);
	} catch (error) {
		console.error('Failed to clean links in text:', error);
		return text; // Return original text on error
	}
};
