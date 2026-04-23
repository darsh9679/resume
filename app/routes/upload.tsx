import {type FormEvent, useEffect, useState} from 'react'
import Navbar from "~/components/Navbar";
import FileUploader from "~/components/FileUploader";
import {usePuterStore} from "~/lib/puter";
import {useNavigate} from "react-router";
import {convertPdfToImage, extractPdfText} from "~/lib/pdf2img";
import {generateUUID} from "~/lib/utils";
import {prepareInstructions} from "../../constants";

const getErrorMessage = (error: unknown): string => {
    if (typeof error === "object" && error !== null) {
        if ("error" in error && typeof error.error === "string") {
            return error.error;
        }

        if ("message" in error && typeof error.message === "string") {
            return error.message;
        }

        if ("delegate" in error && "code" in error) {
            const delegate = typeof error.delegate === "string" ? error.delegate : "unknown";
            const code = typeof error.code === "string" ? error.code : "unknown";
            return `Puter request failed (${delegate}/${code})`;
        }
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "Failed to analyze resume";
};

const Upload = () => {
    const { auth, isLoading, puterReady, fs, ai, kv } = usePuterStore();
    const navigate = useNavigate();
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [file, setFile] = useState<File | null>(null);

    useEffect(() => {
        if(!isLoading && !auth.isAuthenticated) navigate('/auth?next=/upload');
    }, [auth.isAuthenticated, isLoading, navigate]);

    const handleFileSelect = (file: File | null) => {
        setFile(file)
    }

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }: { companyName: string, jobTitle: string, jobDescription: string, file: File  }) => {
        if (!puterReady) {
            setStatusText('Error: Puter is still loading. Please wait a moment and try again.');
            return;
        }

        if (!auth.isAuthenticated) {
            navigate('/auth?next=/upload');
            return;
        }

        setIsProcessing(true);
        setStatusText('Uploading the file...');

        try {
            const uploadedFile = await fs.upload([file]);
            if(!uploadedFile) throw new Error('Failed to upload file');

            setStatusText('Converting to image...');
            const imageFile = await convertPdfToImage(file);
            if(!imageFile.file) throw new Error('Failed to convert PDF to image');

            setStatusText('Uploading the image...');
            const uploadedImage = await fs.upload([imageFile.file]);
            if(!uploadedImage) throw new Error('Failed to upload image');

            setStatusText('Extracting resume text...');
            const resumeText = await extractPdfText(file);
            if (!resumeText || resumeText.trim().length === 0) {
                throw new Error('Could not extract text from PDF. Please make sure your resume is not a scanned image.');
            }

            setStatusText('Preparing data...');
            const uuid = generateUUID();
            const data = {
                id: uuid,
                resumePath: uploadedFile.path,
                imagePath: uploadedImage.path,
                companyName,
                jobTitle,
                jobDescription,
                feedback: '' as Feedback | string,
            };
            await kv.set(`resume:${uuid}`, JSON.stringify(data));

            setStatusText('Analyzing...');

            const feedback = await ai.feedback(
                resumeText,
                prepareInstructions({ jobTitle, jobDescription })
            );
            if (!feedback) throw new Error('Failed to analyze resume');

            const feedbackText = typeof feedback.message.content === 'string'
                ? feedback.message.content
                : feedback.message.content[0]?.text;

            if (!feedbackText) {
                throw new Error('AI returned an empty analysis');
            }

            // Strip markdown code fences if the AI wrapped the JSON in them
            let cleanedText = feedbackText.trim();
            if (cleanedText.startsWith('```')) {
                cleanedText = cleanedText
                    .replace(/^```(?:json)?\s*\n?/, '')
                    .replace(/\n?```\s*$/, '');
            }

            try {
                data.feedback = JSON.parse(cleanedText) as Feedback;
            } catch {
                console.error('Failed to parse AI response:', cleanedText.substring(0, 500));
                throw new Error('AI returned an invalid analysis format. Please try again.');
            }

            await kv.set(`resume:${uuid}`, JSON.stringify(data));
            setStatusText('Analysis complete, redirecting...');
            navigate(`/resume/${uuid}`);
        } catch (error) {
            console.error('Resume analysis failed:', error);
            setStatusText(`Error: ${getErrorMessage(error)}`);
            setIsProcessing(false);
        }
    }

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (isProcessing || isLoading || !puterReady) return;

        const form = e.currentTarget.closest('form');
        if(!form) return;
        const formData = new FormData(form);

        const companyName = formData.get('company-name') as string;
        const jobTitle = formData.get('job-title') as string;
        const jobDescription = formData.get('job-description') as string;

        if(!file) return;

        handleAnalyze({ companyName, jobTitle, jobDescription, file });
    }

    return (
        <main className="bg-[url('/images/bg-main.svg')] bg-cover">
            <Navbar />

            <section className="main-section">
                <div className="page-heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {isProcessing ? (
                        <>
                            <h2>{statusText}</h2>
                            <img src="/images/resume-scan.gif" className="w-full" />
                        </>
                    ) : (
                        <h2>{statusText || 'Drop your resume for an ATS score and improvement tips'}</h2>
                    )}
                    {!isProcessing && (
                        <form id="upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4 mt-8">
                            <div className="form-div">
                                <label htmlFor="company-name">Company Name</label>
                                <input type="text" name="company-name" placeholder="Company Name" id="company-name" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-title">Job Title</label>
                                <input type="text" name="job-title" placeholder="Job Title" id="job-title" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-description">Job Description</label>
                                <textarea rows={5} name="job-description" placeholder="Job Description" id="job-description" />
                            </div>

                            <div className="form-div">
                                <label htmlFor="uploader">Upload Resume</label>
                                <FileUploader onFileSelect={handleFileSelect} />
                            </div>

                            <button
                                className="primary-button"
                                type="submit"
                                disabled={isLoading || !puterReady}
                            >
                                {isLoading || !puterReady ? 'Preparing Puter...' : 'Analyze Resume'}
                            </button>
                        </form>
                    )}
                </div>
            </section>
        </main>
    )
}
export default Upload
