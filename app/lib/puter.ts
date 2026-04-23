import { create } from "zustand";

declare global {
    interface Window {
        puter: {
            auth: {
                getUser: () => Promise<PuterUser>;
                isSignedIn: () => Promise<boolean>;
                signIn: () => Promise<void>;
                signOut: () => Promise<void>;
            };
            fs: {
                write: (
                    path: string,
                    data: string | File | Blob
                ) => Promise<File | undefined>;
                read: (path: string) => Promise<Blob>;
                upload: (file: File[] | Blob[]) => Promise<FSItem>;
                delete: (path: string) => Promise<void>;
                readdir: (path: string) => Promise<FSItem[] | undefined>;
            };
            ai: {
                chat: {
                    (
                        prompt: string,
                        options?: PuterChatOptions
                    ): Promise<Object>;
                    (
                        prompt: string,
                        testMode?: boolean,
                        options?: PuterChatOptions
                    ): Promise<Object>;
                    (
                        prompt: string,
                        imageURL?: string | File | Blob | string[],
                        testMode?: boolean,
                        options?: PuterChatOptions
                    ): Promise<Object>;
                    (
                        prompt: ChatMessage[],
                        testMode?: boolean,
                        options?: PuterChatOptions
                    ): Promise<Object>;
                };
                img2txt: (
                    image: string | File | Blob,
                    testMode?: boolean
                ) => Promise<string>;
            };
            kv: {
                get: (key: string) => Promise<string | null>;
                set: (key: string, value: string) => Promise<boolean>;
                delete: (key: string) => Promise<boolean>;
                list: (pattern: string, returnValues?: boolean) => Promise<string[]>;
                flush: () => Promise<boolean>;
            };
        };
    }
}

interface PuterStore {
    isLoading: boolean;
    error: string | null;
    puterReady: boolean;
    auth: {
        user: PuterUser | null;
        isAuthenticated: boolean;
        signIn: () => Promise<void>;
        signOut: () => Promise<void>;
        refreshUser: () => Promise<void>;
        checkAuthStatus: () => Promise<boolean>;
        getUser: () => PuterUser | null;
    };
    fs: {
        write: (
            path: string,
            data: string | File | Blob
        ) => Promise<File | undefined>;
        read: (path: string) => Promise<Blob | undefined>;
        upload: (file: File[] | Blob[]) => Promise<FSItem | undefined>;
        delete: (path: string) => Promise<void>;
        readDir: (path: string) => Promise<FSItem[] | undefined>;
    };
    ai: {
        chat: (
            prompt: string | ChatMessage[],
            imageURL?: string | PuterChatOptions,
            testMode?: boolean,
            options?: PuterChatOptions
        ) => Promise<AIResponse | undefined>;
        feedback: (
            resumeText: string,
            message: string
        ) => Promise<AIResponse | undefined>;
        img2txt: (
            image: string | File | Blob,
            testMode?: boolean
        ) => Promise<string | undefined>;
    };
    kv: {
        get: (key: string) => Promise<string | null | undefined>;
        set: (key: string, value: string) => Promise<boolean | undefined>;
        delete: (key: string) => Promise<boolean | undefined>;
        list: (
            pattern: string,
            returnValues?: boolean
        ) => Promise<string[] | KVItem[] | undefined>;
        flush: () => Promise<boolean | undefined>;
    };

    init: () => void;
    clearError: () => void;
}

const getPuter = (): typeof window.puter | null =>
    typeof window !== "undefined" && window.puter ? window.puter : null;

const FEEDBACK_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;

const getPuterErrorMessage = (error: unknown): string => {
    if (typeof error === "object" && error !== null) {
        if ("error" in error && typeof error.error === "string") {
            return error.error;
        }

        // Handle nested error objects from Puter: { error: { code: "...", message: "..." } }
        if ("error" in error && typeof error.error === "object" && error.error !== null) {
            const nested = error.error as Record<string, unknown>;
            if (typeof nested.message === "string") return nested.message;
            if (typeof nested.code === "string") return nested.code;
        }

        if ("message" in error && typeof error.message === "string") {
            return error.message;
        }

        if ("code" in error && typeof (error as Record<string, unknown>).code === "string") {
            return (error as Record<string, string>).code;
        }
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "Unexpected Puter AI error";
};

const hasStringProperty = (
    value: unknown,
    property: string
): value is Record<string, string> =>
    typeof value === "object" &&
    value !== null &&
    property in value &&
    typeof (value as Record<string, unknown>)[property] === "string";

const isRetryableModelError = (error: unknown): boolean => {
    const message = getPuterErrorMessage(error).toLowerCase();
    const errorStr = JSON.stringify(error).toLowerCase();

    if (
        message.includes("model not found") ||
        message.includes("permission denied") ||
        message.includes("usage-limited-chat") ||
        message.includes("not found") ||
        message.includes("404")
    ) {
        return true;
    }

    // Check for nested error structures from Puter (e.g. 404 from provider)
    if (
        errorStr.includes("not_found_error") ||
        errorStr.includes("model_not_found") ||
        errorStr.includes("404") ||
        errorStr.includes("ai_chat_all_providers_failed")
    ) {
        return true;
    }

    if (hasStringProperty(error, "delegate") && error.delegate === "usage-limited-chat") {
        return true;
    }

    if (
        hasStringProperty(error, "code") &&
        (error.code === "error_400_from_delegate" ||
         error.code === "ai_chat_all_providers_failed")
    ) {
        return true;
    }

    return false;
};

const isPuterChatOptions = (value: unknown): value is PuterChatOptions =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const callPuterChat = async (
    puter: NonNullable<ReturnType<typeof getPuter>>,
    prompt: string | ChatMessage[],
    options?: PuterChatOptions
) => {
    if (Array.isArray(prompt)) {
        if (options) {
            return puter.ai.chat(prompt, false, options);
        }

        return puter.ai.chat(prompt);
    }

    if (options) {
        return puter.ai.chat(prompt, options);
    }

    return puter.ai.chat(prompt);
};

export const usePuterStore = create<PuterStore>((set, get) => {
    const setError = (msg: string) => {
        set({
            error: msg,
            isLoading: false,
            auth: {
                user: null,
                isAuthenticated: false,
                signIn: get().auth.signIn,
                signOut: get().auth.signOut,
                refreshUser: get().auth.refreshUser,
                checkAuthStatus: get().auth.checkAuthStatus,
                getUser: get().auth.getUser,
            },
        });
    };

    const checkAuthStatus = async (): Promise<boolean> => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return false;
        }

        set({ isLoading: true, error: null });

        try {
            const isSignedIn = await puter.auth.isSignedIn();
            if (isSignedIn) {
                const user = await puter.auth.getUser();
                set({
                    auth: {
                        user,
                        isAuthenticated: true,
                        signIn: get().auth.signIn,
                        signOut: get().auth.signOut,
                        refreshUser: get().auth.refreshUser,
                        checkAuthStatus: get().auth.checkAuthStatus,
                        getUser: () => user,
                    },
                    isLoading: false,
                });
                return true;
            } else {
                set({
                    auth: {
                        user: null,
                        isAuthenticated: false,
                        signIn: get().auth.signIn,
                        signOut: get().auth.signOut,
                        refreshUser: get().auth.refreshUser,
                        checkAuthStatus: get().auth.checkAuthStatus,
                        getUser: () => null,
                    },
                    isLoading: false,
                });
                return false;
            }
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : "Failed to check auth status";
            setError(msg);
            return false;
        }
    };

    const signIn = async (): Promise<void> => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }

        set({ isLoading: true, error: null });

        try {
            await puter.auth.signIn();
            await checkAuthStatus();
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Sign in failed";
            setError(msg);
        }
    };

    const signOut = async (): Promise<void> => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }

        set({ isLoading: true, error: null });

        try {
            await puter.auth.signOut();
            set({
                auth: {
                    user: null,
                    isAuthenticated: false,
                    signIn: get().auth.signIn,
                    signOut: get().auth.signOut,
                    refreshUser: get().auth.refreshUser,
                    checkAuthStatus: get().auth.checkAuthStatus,
                    getUser: () => null,
                },
                isLoading: false,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Sign out failed";
            setError(msg);
        }
    };

    const refreshUser = async (): Promise<void> => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }

        set({ isLoading: true, error: null });

        try {
            const user = await puter.auth.getUser();
            set({
                auth: {
                    user,
                    isAuthenticated: true,
                    signIn: get().auth.signIn,
                    signOut: get().auth.signOut,
                    refreshUser: get().auth.refreshUser,
                    checkAuthStatus: get().auth.checkAuthStatus,
                    getUser: () => user,
                },
                isLoading: false,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to refresh user";
            setError(msg);
        }
    };

    const init = (): void => {
        const puter = getPuter();
        if (puter) {
            set({ puterReady: true });
            checkAuthStatus();
            return;
        }

        const interval = setInterval(() => {
            if (getPuter()) {
                clearInterval(interval);
                set({ puterReady: true });
                checkAuthStatus();
            }
        }, 100);

        setTimeout(() => {
            clearInterval(interval);
            if (!getPuter()) {
                setError("Puter.js failed to load within 10 seconds");
            }
        }, 10000);
    };

    const write = async (path: string, data: string | File | Blob) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.fs.write(path, data);
    };

    const readDir = async (path: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.fs.readdir(path);
    };

    const readFile = async (path: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.fs.read(path);
    };

    const upload = async (files: File[] | Blob[]) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.fs.upload(files);
    };

    const deleteFile = async (path: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.fs.delete(path);
    };

    const chat = async (
        prompt: string | ChatMessage[],
        imageURL?: string | PuterChatOptions,
        testMode?: boolean,
        options?: PuterChatOptions
    ) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }

        if (Array.isArray(prompt)) {
            const resolvedOptions = isPuterChatOptions(imageURL) ? imageURL : options;

            return puter.ai.chat(prompt, testMode, resolvedOptions) as Promise<
                AIResponse | undefined
            >;
        }

        if (isPuterChatOptions(imageURL)) {
            return puter.ai.chat(prompt, imageURL) as Promise<AIResponse | undefined>;
        }

        return puter.ai.chat(prompt, imageURL, testMode, options) as Promise<
            AIResponse | undefined
        >;
    };

    const feedback = async (resumeText: string, message: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }

        // Send resume text directly in the prompt instead of using puter_path
        // (puter_path file references don't work with all AI models)
        const fullPrompt = `${message}\n\n--- RESUME CONTENT ---\n${resumeText}\n--- END OF RESUME ---`;

        let lastError: unknown;

        for (const model of FEEDBACK_MODELS) {
            try {
                return (await callPuterChat(puter, fullPrompt, {
                    model,
                })) as AIResponse | undefined;
            } catch (error) {
                lastError = error;

                if (!isRetryableModelError(error)) {
                    throw error;
                }
            }
        }

        try {
            return (await callPuterChat(puter, fullPrompt)) as AIResponse | undefined;
        } catch (error) {
            lastError = error;
        }

        throw new Error(getPuterErrorMessage(lastError));
    };

    const img2txt = async (image: string | File | Blob, testMode?: boolean) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.ai.img2txt(image, testMode);
    };

    const getKV = async (key: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.kv.get(key);
    };

    const setKV = async (key: string, value: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.kv.set(key, value);
    };

    const deleteKV = async (key: string) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.kv.delete(key);
    };

    const listKV = async (pattern: string, returnValues?: boolean) => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        if (returnValues === undefined) {
            returnValues = false;
        }
        return puter.kv.list(pattern, returnValues);
    };

    const flushKV = async () => {
        const puter = getPuter();
        if (!puter) {
            setError("Puter.js not available");
            return;
        }
        return puter.kv.flush();
    };

    return {
        isLoading: true,
        error: null,
        puterReady: false,
        auth: {
            user: null,
            isAuthenticated: false,
            signIn,
            signOut,
            refreshUser,
            checkAuthStatus,
            getUser: () => get().auth.user,
        },
        fs: {
            write: (path: string, data: string | File | Blob) => write(path, data),
            read: (path: string) => readFile(path),
            readDir: (path: string) => readDir(path),
            upload: (files: File[] | Blob[]) => upload(files),
            delete: (path: string) => deleteFile(path),
        },
        ai: {
            chat: (
                prompt: string | ChatMessage[],
                imageURL?: string | PuterChatOptions,
                testMode?: boolean,
                options?: PuterChatOptions
            ) => chat(prompt, imageURL, testMode, options),
            feedback: (resumeText: string, message: string) => feedback(resumeText, message),
            img2txt: (image: string | File | Blob, testMode?: boolean) =>
                img2txt(image, testMode),
        },
        kv: {
            get: (key: string) => getKV(key),
            set: (key: string, value: string) => setKV(key, value),
            delete: (key: string) => deleteKV(key),
            list: (pattern: string, returnValues?: boolean) =>
                listKV(pattern, returnValues),
            flush: () => flushKV(),
        },
        init,
        clearError: () => set({ error: null }),
    };
});
