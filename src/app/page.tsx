// src/app/page.tsx
'use client';

import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice, calculateFee, coin } from '@cosmjs/stargate';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster, toast } from "sonner";
import { Loader2, AlertTriangle, Upload, CheckCircle, XCircle, Copy, Settings, Info, Check, CircleDollarSign } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

// --- Types ---
interface NetworkConfig {
  chainId: string;
  rpcEndpoint: string;
  restEndpoint: string;
  gasPrice: string;
  cw20CodeId: number;
  explorerBaseUrl: string;
  explorerTxPath: string;
  faucetUrl?: string;
  denom: string;
}

interface WalletWindow extends Window {
  keplr?: any;
  leap?: any;
  // Add specific event listener types if known, otherwise rely on generic window events
}
declare var window: WalletWindow;

// --- Configuration (Hardcoded for Testnet) ---
const buildTestnetConfig = (): NetworkConfig | null => {
  const chainId = process.env.NEXT_PUBLIC_TESTNET_CHAIN_ID;
  const rpcEndpoint = process.env.NEXT_PUBLIC_TESTNET_RPC_ENDPOINT;
  const restEndpoint = process.env.NEXT_PUBLIC_TESTNET_REST_ENDPOINT;
  const gasPrice = process.env.NEXT_PUBLIC_TESTNET_GAS_PRICE;
  const cw20CodeIdStr = process.env.NEXT_PUBLIC_TESTNET_CW20_CODE_ID;
  const cw20CodeId = parseInt(cw20CodeIdStr || '0', 10);
  const explorerBaseUrl = 'https://testnet.sei.explorers.guru';
  const explorerTxPath = '/transaction/';
  const faucetUrl = 'https://atlantic-2.app.sei.io/faucet';
  const denom = 'usei';

  // Basic check for presence of essential variables
  if (!chainId || !rpcEndpoint || !restEndpoint || !gasPrice || !cw20CodeIdStr) {
    console.error("Missing essential TESTNET environment variables. Check .env.local file.");
    return null; // Return null if configuration is incomplete
  }
  // Warning if Code ID is invalid (0 or NaN)
  if (cw20CodeId <= 0) {
    console.warn(`Invalid TESTNET CW20 Code ID detected (${cw20CodeIdStr} -> ${cw20CodeId}). Check .env.local file.`);
    // Note: Still returns config, but launch will likely fail later if ID is truly invalid
  }
  // Return the configuration object
  return { chainId, rpcEndpoint, restEndpoint, gasPrice, cw20CodeId, explorerBaseUrl, explorerTxPath, faucetUrl, denom };
};

// Attempt to build the testnet configuration when the module loads
const testnetConfig: NetworkConfig | null = buildTestnetConfig();
// Read instantiateGas from env, provide a default value
const instantiateGas = process.env.NEXT_PUBLIC_INSTANTIATE_GAS || '500000';

// --- Pinata Config Check ---
// Removed client-side key reading as upload is handled by backend API route

export default function LaunchpadPage() {
  // --- State Variables ---
  // Wallet and network connection state
  const [signingClient, setSigningClient] = useState<SigningCosmWasmClient | null>(null);
  const [userAddress, setUserAddress] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false); // Loading state for wallet connection
  const [isLaunching, setIsLaunching] = useState<boolean>(false); // Loading state for token launch
  const [currentChainId, setCurrentChainId] = useState<string | null>(null); // Actual chain ID wallet is connected to

  // Form State - Basic token details
  const [tokenName, setTokenName] = useState<string>('');
  const [tokenSymbol, setTokenSymbol] = useState<string>('');
  const [tokenDecimals, setTokenDecimals] = useState<string>('6'); // Default to 6 decimals
  const [tokenSupply, setTokenSupply] = useState<string>(''); // Initial supply to mint

  // Form State - Image Upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null); // The selected image file
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // Local URL for image preview
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false); // Loading state for image upload
  const [ipfsUrl, setIpfsUrl] = useState<string | null>(null); // IPFS URL after successful upload

  // Form State - Marketing Info
  const [projectName, setProjectName] = useState<string>(''); // Optional project name
  const [description, setDescription] = useState<string>(''); // Optional token description

  // Form State - Minting Options
  const [mintOption, setMintOption] = useState<'fixed' | 'minter'>('fixed'); // Default to fixed supply
  const [mintCap, setMintCap] = useState<string>(''); // Optional minting cap if mintable

  // Success State - Stores details of the last launched token
  const [lastLaunchedToken, setLastLaunchedToken] = useState<{ address: string; tx: string; name: string; symbol: string; ipfsUrl?: string | null } | null>(null);

  // --- Derived State & Memos ---
  // Memoized configuration object (currently hardcoded to testnet)
  const config = useMemo((): NetworkConfig | null => testnetConfig, []);
  // Check if the environment configuration loaded successfully
  const isEnvConfigured = useMemo(() => !!config, [config]);
  // Check if the Code ID from config is valid (greater than 0)
  const isCodeIdValid = useMemo(() => !!config && config.cw20CodeId > 0, [config]);
  // Check if the connected wallet's chain ID matches the required config chain ID
  const isWalletConnectedToCorrectNetwork = useMemo(() => {
    return !!userAddress && !!currentChainId && !!config && currentChainId === config.chainId;
  }, [userAddress, currentChainId, config]);
  // Calculate estimated fee based on gas limit and gas price from config
  const estimatedFee = useMemo(() => {
    if (!config?.gasPrice) return null; // Need gas price from config
    try {
      // Use the instantiateGas limit (from env or default) and configured gasPrice
      const fee = calculateFee(Number(instantiateGas), GasPrice.fromString(config.gasPrice));
      const feeCoin = fee.amount[0]; // Get the first fee coin (should be usei)
      // Format amount: divide by 10^6 for SEI/USEI, fix to 6 decimal places
      const displayAmount = (parseInt(feeCoin.amount) / (10**6)).toFixed(6);
      return `~${displayAmount} SEI`; // Display as SEI
    } catch (e) {
      console.error("Fee calculation error", e);
      return null; // Return null if calculation fails
    }
  }, [config?.gasPrice]); // Recalculate if gas price changes (relevant if network switching is re-enabled)

  // --- Effects ---
  // Effect to clean up object URLs created for image previews
  useEffect(() => {
    // This function runs when the component unmounts or when previewUrl changes
    return () => {
      if (previewUrl) {
        // Revoke the object URL to free up memory
        URL.revokeObjectURL(previewUrl);
        console.log("Revoked preview URL:", previewUrl);
      }
    };
  }, [previewUrl]); // Dependency array: run effect when previewUrl changes

  // --- CORRECTED Wallet change listener effect ---
  useEffect(() => {
    // Define the handler function to be called when wallet changes
    const handleAccountChange = () => {
      console.log("Wallet account or network changed detected via listener.");
      // Reset connection state because we don't know the new account/network validity
      setUserAddress('');
      setSigningClient(null);
      setCurrentChainId(null);
      // Notify user to reconnect
      toast.info("Wallet Changed", { description: "Wallet account or network changed. Please reconnect.", duration: 5000 });
    };

    // Add event listener for Keplr's keystore change event
    // This is the standard way to detect account/network changes in Keplr
    console.log("Setting up wallet change listener for 'keplr_keystorechange'");
    window.addEventListener('keplr_keystorechange', handleAccountChange);

    // TODO: Add similar listener for Leap wallet if its event name is known and different
    // window.addEventListener('leap_keystorechange', handleAccountChange);

    // Cleanup function: Remove the event listener when the component unmounts
    return () => {
      console.log("Cleaning up wallet change listener for 'keplr_keystorechange'");
      window.removeEventListener('keplr_keystorechange', handleAccountChange);
      // window.removeEventListener('leap_keystorechange', handleAccountChange); // Clean up other listeners if added
    };
  }, []); // Empty dependency array ensures this effect runs only once on mount and cleans up on unmount


  // --- Wallet Connection ---
  const handleConnectWallet = async () => {
    console.log("handleConnectWallet called"); // Log function start
    // Check if essential configuration is loaded
    if (!config) {
      console.error("handleConnectWallet: Configuration Error! `config` is null."); // Log config error
      toast.error("Configuration Error", { description: "Testnet configuration missing or invalid in .env.local." });
      return;
    }
    console.log("handleConnectWallet: Config found:", config); // Log loaded config

    setIsConnecting(true); // Set loading state
    toast("Connecting Wallet...", { description: `Please approve connection for ${config.chainId} in your wallet.` });

    // Detect Keplr or Leap wallet extension
    const wallet = window.leap || window.keplr;
    console.log("handleConnectWallet: Wallet object:", wallet); // Log detected wallet object
    if (!wallet) {
      console.error("handleConnectWallet: Wallet Not Found!"); // Log wallet not found
      toast.error("Wallet Not Found", { description: "Please install Keplr or Leap wallet extension." });
      setIsConnecting(false); // Reset loading state
      return;
    }

    try {
      // Request connection to the specified chain
      console.log(`handleConnectWallet: Attempting wallet.enable('${config.chainId}')...`); // Log action
      await wallet.enable(config.chainId);
      console.log("handleConnectWallet: wallet.enable() successful."); // Log success

      // Get the offline signer interface
      console.log("handleConnectWallet: Attempting wallet.getOfflineSigner()..."); // Log action
      const offlineSigner = await wallet.getOfflineSigner(config.chainId);
      console.log("handleConnectWallet: Got offlineSigner."); // Log success

      // Get accounts associated with the signer
      console.log("handleConnectWallet: Attempting offlineSigner.getAccounts()..."); // Log action
      const accounts = await offlineSigner.getAccounts();
      console.log("handleConnectWallet: Got accounts:", accounts); // Log retrieved accounts
      if (accounts.length === 0) throw new Error("No accounts found in wallet."); // Check if accounts exist
      const address = accounts[0].address; // Get the first account address

      // Connect to the blockchain node with the signer
      console.log("handleConnectWallet: Attempting SigningCosmWasmClient.connectWithSigner()..."); // Log action
      const client = await SigningCosmWasmClient.connectWithSigner(
          config.rpcEndpoint, // Use RPC endpoint from config
          offlineSigner,
          { gasPrice: GasPrice.fromString(config.gasPrice) } // Use gas price from config
      );
      console.log("handleConnectWallet: Client connected."); // Log success

      // Verify the chain ID the client is connected to
      console.log("handleConnectWallet: Attempting client.getChainId()..."); // Log action
      const connectedChainId = await client.getChainId();
      console.log("handleConnectWallet: Got chainId:", connectedChainId); // Log retrieved chain ID
      if (connectedChainId !== config.chainId) {
        // Throw error if connected chain doesn't match expected chain
        throw new Error(`Wallet connected to wrong chain: ${connectedChainId}. Expected ${config.chainId}.`);
      }

      // Update state on successful connection
      setUserAddress(address);
      setSigningClient(client);
      setCurrentChainId(connectedChainId);
      toast.success("Wallet Connected", { description: `Address: ${address.substring(0, 10)}... on ${connectedChainId}` });
      console.log("handleConnectWallet: Success! State updated."); // Log final success

    } catch (error: any) {
      // Handle errors during the connection process
      console.error("Wallet connection failed inside try/catch:", error); // Log the error
      toast.error("Connection Failed", { description: error.message || "An unknown error occurred." });
      // Reset state on failure
      setUserAddress('');
      setSigningClient(null);
      setCurrentChainId(null);
    } finally {
      // Always reset the connecting state, whether success or failure
      console.log("handleConnectWallet: finally block executing."); // Log execution of finally block
      setIsConnecting(false);
    }
  };

  // --- Image Handling (Calls backend API route) ---
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; // Get the first selected file
    // Clear state if no file is selected or selection is cancelled
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setIpfsUrl(null);
      setIsUploadingImage(false);
      if (previewUrl) URL.revokeObjectURL(previewUrl); // Clean up previous preview
      return;
    }
    // Basic file validation
    if (!file.type.startsWith('image/')) {
      toast.error("Invalid File Type", { description: "Please select an image file (PNG, JPG, GIF, SVG)." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) { // 5MB size limit
      toast.error("File Too Large", { description: "Image size should not exceed 5MB." });
      return;
    }

    // Update state with the selected file
    setSelectedFile(file);
    setIpfsUrl(null); // Reset previous IPFS URL
    if (previewUrl) URL.revokeObjectURL(previewUrl); // Clean up previous preview URL
    setPreviewUrl(URL.createObjectURL(file)); // Create and set local preview URL

    // Automatically start the upload process
    handleImageUpload(file);
  };

  const handleImageUpload = async (file: File | null) => {
    if (!file) {
      toast.error("No file selected for upload.");
      return;
    }
    // No need to check Pinata config on client-side anymore

    setIsUploadingImage(true); // Set uploading state
    setIpfsUrl(null); // Clear previous IPFS URL
    toast("Uploading Image...", { description: "Sending to server for IPFS upload..." });

    // Prepare form data to send to the backend API route
    const formData = new FormData();
    formData.append('file', file);

    try {
      // Call the backend API route at /api/upload
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData, // Send the file within FormData
      });

      // Get the JSON response from the API route
      const result = await response.json();

      // Check if the API call was successful
      if (!response.ok) {
        // Throw error using message from backend response if available
        throw new Error(result.error || `Upload failed: ${response.statusText}`);
      }

      // Check if the backend returned the IPFS URL
      if (!result.ipfsUrl) {
        throw new Error("IPFS URL not found in server response.");
      }

      // Success: Update state with the IPFS URL from the backend
      setIpfsUrl(result.ipfsUrl);
      toast.success("Image Uploaded!", { description: `IPFS URL generated.` });
      console.log("IPFS URL from server:", result.ipfsUrl);

    } catch (error: any) {
      // Handle errors during the API call or upload process
      console.error("API Upload failed:", error);
      toast.error("Image Upload Failed", { description: error.message || "Could not upload image via server." });
      setIpfsUrl(null); // Clear IPFS URL state on failure
    } finally {
      // Always reset the uploading state
      setIsUploadingImage(false);
    }
  };


  // --- Token Launch (Constructs InstantiateMsg with all options) ---
  const handleLaunchToken = async (event: React.FormEvent) => {
    event.preventDefault(); // Prevent default form submission behavior (page reload)
    console.log("handleLaunchToken: event.preventDefault() called");

    // --- Pre-flight Checks ---
    // Ensure wallet is connected, on the right network, and config is valid
    console.log("handleLaunchToken: Running pre-flight checks...");
    if (!signingClient || !userAddress || !config) { console.error("Launch Check Fail: Prerequisites Not Met"); toast.error("Prerequisites Not Met"); return; }
    if (!isWalletConnectedToCorrectNetwork) { console.error("Launch Check Fail: Network Mismatch"); toast.error("Network Mismatch"); return; }
    if (!isCodeIdValid) { console.error("Launch Check Fail: Invalid Code ID"); toast.error("Configuration Issue: Invalid Code ID"); return; }

    // Validate basic form inputs
    const decimalsNum = parseInt(tokenDecimals, 10);
    const supplyNum = parseInt(tokenSupply, 10); // Use BigInt for calculations below
    if (!tokenName || !tokenSymbol || isNaN(decimalsNum) || decimalsNum < 0 || decimalsNum > 18 || isNaN(supplyNum) || supplyNum <= 0) {
      console.error("Launch Check Fail: Invalid Form Data"); toast.error("Invalid Form Data"); return;
    }

    // Validate mint cap if mintable option is selected
    let formattedMintCap: string | null = null;
    if (mintOption === 'minter' && mintCap) {
      const capNum = parseInt(mintCap);
      if (isNaN(capNum) || capNum <= 0) {
        console.error("Launch Check Fail: Invalid Mint Cap Value"); toast.error("Invalid Mint Cap", { description: "Mint cap must be a positive number if provided." }); return;
      }
      // Ensure cap is at least the initial supply (important!)
      if (capNum < supplyNum) {
        console.error("Launch Check Fail: Mint Cap Too Low"); toast.error("Invalid Mint Cap", { description: `Cap (${mintCap}) must be >= initial supply (${tokenSupply}).` }); return;
      }
      // Format the cap with decimals
      formattedMintCap = (BigInt(mintCap) * (10n ** BigInt(decimalsNum))).toString();
    }

    // Check image upload status
    if (isUploadingImage) { console.warn("Launch Check Fail: Image Uploading"); toast.info("Please Wait", { description: "Image is still uploading..." }); return; }
    // If a file was selected but upload failed (no ipfsUrl), block launch
    if (selectedFile && !ipfsUrl) { console.error("Launch Check Fail: Image Upload Pending/Failed"); toast.error("Image Upload Pending/Failed. Please re-select or wait."); return; }
    console.log("handleLaunchToken: Pre-flight checks passed.");

    // Start launch process
    setIsLaunching(true);
    setLastLaunchedToken(null); // Clear previous launch details
    toast("Launching Token...", { description: `Submitting transaction on ${config.chainId}...` });
    console.log("handleLaunchToken: Launch process started.");

    try {
      // Calculate initial supply with decimals
      const initialSupply = (BigInt(tokenSupply) * (10n ** BigInt(decimalsNum))).toString();

      // Construct the Instantiate Message for the CW20 contract
      const instantiateMsg: any = {
        name: tokenName,
        symbol: tokenSymbol,
        decimals: decimalsNum,
        initial_balances: [{ address: userAddress, amount: initialSupply }], // Mint initial supply to creator
        // Set minting info based on user selection
        mint: mintOption === 'minter'
            ? {
              minter: userAddress, // Creator is the minter
              cap: formattedMintCap // Use formatted cap (or null if blank/invalid)
            }
            : null, // null means fixed supply
        // Set marketing info if provided
        marketing: {
          project: projectName || null, // Use state value or null
          description: description || null, // Use state value or null
          marketing: userAddress, // Allow creator to update marketing info later
          logo: ipfsUrl ? { url: ipfsUrl } : null // Use IPFS URL if available
        }
      };

      console.log("Instantiate Message:", JSON.stringify(instantiateMsg, null, 2)); // Log the message being sent

      // Calculate transaction fee
      const fee = calculateFee(Number(instantiateGas), GasPrice.fromString(config.gasPrice));
      console.log("Calculated Fee:", fee);

      // Execute the instantiate transaction
      console.log("handleLaunchToken: Calling client.instantiate...");
      const result = await signingClient.instantiate(
          userAddress, // Sender address
          config.cw20CodeId, // Code ID from config
          instantiateMsg, // The instantiation message payload
          tokenName, // A human-readable label for the contract
          fee, // Calculated transaction fee
          { memo: "Created via No-Code Launchpad", admin: userAddress } // Optional memo and admin address
      );
      console.log("handleLaunchToken: client.instantiate successful:", result); // Log success result

      // Extract results
      const contractAddress = result.contractAddress;
      const txHash = result.transactionHash;
      const explorerLink = `${config.explorerBaseUrl}${config.explorerTxPath || '/transaction/'}${txHash}`;

      // Update state to show confirmation details
      setLastLaunchedToken({ address: contractAddress, tx: txHash, name: tokenName, symbol: tokenSymbol, ipfsUrl: ipfsUrl });

      // Show success toast
      toast.success("Token Launched Successfully!", {
        description: `Contract: ${contractAddress.substring(0,15)}...`,
        duration: 10000, // Keep toast longer
      });

      // Reset form fields completely after successful launch
      setTokenName(''); setTokenSymbol(''); setTokenDecimals('6'); setTokenSupply('');
      setSelectedFile(null); setPreviewUrl(null); setIpfsUrl(null); setIsUploadingImage(false);
      setProjectName(''); setDescription(''); setMintOption('fixed'); setMintCap('');

    } catch (error: any) {
      // Handle errors during transaction execution
      console.error("Token launch failed inside try/catch:", error);
      // Format error message for toast
      let errorMessage = error.message || "Transaction failed.";
      if (error.log) { // Try to get more specific error from logs if available
        errorMessage = `Transaction failed: ${error.log}`;
      } else if (error.code) { // Include error code if available
        errorMessage = `Error code ${error.code}: ${errorMessage}`;
      }
      toast.error("Launch Failed", { description: errorMessage, duration: 10000 });
    } finally {
      // Always reset launching state
      console.log("handleLaunchToken: finally block executing.");
      setIsLaunching(false);
    }
  };

  // --- Helper function to copy text to clipboard ---
  const copyToClipboard = (text: string | null | undefined, label: string) => {
    if (!text) return; // Don't copy if text is null or undefined
    navigator.clipboard.writeText(text)
        .then(() => toast.success(`${label} Copied!`)) // Show success toast
        .catch(err => {
          console.error("Copy to clipboard failed:", err); // Log error
          toast.error('Failed to copy text.'); // Show error toast
        });
  };

  // --- Render ---
  return (
      // Using React Fragment as the top-level element
      <>
        {/* Main container div */}
        <div className="flex flex-col items-center justify-center min-h-screen p-4 sm:p-6 bg-gray-50">
          {/* Toaster component for notifications */}
          <Toaster richColors position="top-center" />
          {/* Main Card component */}
          <Card className="w-full max-w-2xl shadow-xl border border-gray-200 rounded-lg">
            {/* Card Header */}
            <CardHeader className="text-center bg-gradient-to-r from-gray-100 to-gray-200 p-6 rounded-t-lg border-b">
              <CardTitle className="text-3xl font-bold text-gray-800">Sei No-Code Launchpad</CardTitle>
              <CardDescription className="text-gray-600 mt-1">Create your CW20 token on Sei Testnet (Atlantic-2)</CardDescription>
            </CardHeader>

            {/* Card Content */}
            <CardContent className="p-6 md:p-8 space-y-8">

              {/* --- Section 1: Connect Wallet --- */}
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-gray-700 flex items-center border-b pb-2 mb-4">
                  {/* Step indicator circle */}
                  <span className={`mr-3 flex h-8 w-8 items-center justify-center rounded-full text-lg ${userAddress ? 'bg-green-600' : 'bg-gray-400'} text-white transition-colors duration-300`}>
                                    {userAddress ? <Check size={20}/> : '1'}
                                </span>
                  Connect Wallet
                </h2>
                {/* Configuration Warnings */}
                {!isEnvConfigured && ( <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Config Error</AlertTitle><AlertDescription>Check .env.local & restart server.</AlertDescription></Alert> )}
                {isEnvConfigured && !isCodeIdValid && ( <Alert variant="warning"><AlertTriangle className="h-4 w-4" /><AlertTitle>Code ID Warning</AlertTitle><AlertDescription>Testnet CW20 Code ID (`{config?.cw20CodeId}`) seems invalid. Check `.env.local`.</AlertDescription></Alert> )}

                {/* Indented content for this step */}
                <div className="pl-11">
                  <Button onClick={handleConnectWallet} disabled={isConnecting || !config || !!signingClient} className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-md py-3 text-base transition-opacity duration-300 disabled:opacity-60">
                    {isConnecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...</> : signingClient ? 'Wallet Connected' : 'Connect Wallet (Keplr/Leap)'}
                  </Button>
                  {/* Display wallet info if connected */}
                  {userAddress && (
                      <div className={`mt-3 p-3 border rounded-md text-sm transition-colors duration-300 ${isWalletConnectedToCorrectNetwork ? 'bg-green-50 border-green-200 text-green-800' : 'bg-yellow-50 border-yellow-300 text-yellow-800'}`}>
                        <p className="font-medium flex items-center">
                          {isWalletConnectedToCorrectNetwork ? <CheckCircle className="w-4 h-4 mr-2"/> : <AlertTriangle className="w-4 h-4 mr-2"/>}
                          {isWalletConnectedToCorrectNetwork ? `Connected: ${currentChainId}` : `Wallet on wrong network (${currentChainId})`}
                        </p>
                        <p className="text-xs font-mono break-all mt-1">{userAddress}</p>
                        {!isWalletConnectedToCorrectNetwork && config && ( <p className="text-xs font-bold mt-1">Please switch wallet to {config.chainId}.</p> )}
                      </div>
                  )}
                </div>
              </section>

              {/* Separator only shown if wallet is connected */}
              {userAddress && <Separator />}

              {/* --- Section 2 & 3: Configure & Launch Form --- */}
              {/* Section disabled visually if wallet not connected to correct network */}
              <section className={`space-y-6 ${!isWalletConnectedToCorrectNetwork ? 'opacity-50 pointer-events-none' : ''}`}>
                <h2 className="text-xl font-semibold text-gray-700 flex items-center border-b pb-2">
                  {/* Step indicator circle */}
                  <span className={`mr-3 flex h-8 w-8 items-center justify-center rounded-full text-lg ${isWalletConnectedToCorrectNetwork ? 'bg-blue-600' : 'bg-gray-400'} text-white transition-colors duration-300`}>2</span>
                  Configure & Launch Token
                </h2>
                {/* Form encompassing all configuration and the launch button */}
                <form onSubmit={handleLaunchToken} className="space-y-6 pl-11">

                  {/* Subsection: Basic Information */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-600">Basic Information</h3>
                    {/* Grid layout for basic inputs */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div> <Label htmlFor="tokenName">Name <span className="text-red-500">*</span></Label> <Input id="tokenName" value={tokenName} onChange={(e) => setTokenName(e.target.value)} required disabled={isLaunching} placeholder="My Awesome Token"/> </div>
                      <div> <Label htmlFor="tokenSymbol">Symbol <span className="text-red-500">*</span></Label> <Input id="tokenSymbol" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())} required disabled={isLaunching} maxLength={8} placeholder="MAT"/> <p className="text-xs text-gray-500 mt-1">3-8 uppercase letters.</p> </div>
                      <div> <Label htmlFor="tokenDecimals">Decimals <span className="text-red-500">*</span></Label> <Input id="tokenDecimals" type="number" value={tokenDecimals} onChange={(e) => setTokenDecimals(e.target.value)} required disabled={isLaunching} min="0" max="18" /> <p className="text-xs text-gray-500 mt-1">Usually 6 or 18.</p> </div>
                      <div> <Label htmlFor="tokenSupply">Initial Supply <span className="text-red-500">*</span></Label> <Input id="tokenSupply" type="number" value={tokenSupply} onChange={(e) => setTokenSupply(e.target.value)} required disabled={isLaunching} min="1" placeholder="1000000"/> <p className="text-xs text-gray-500 mt-1">Tokens minted to you on launch.</p> </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Subsection: Minting Options */}
                  <div className="space-y-3">
                    <Label className="flex items-center text-lg font-medium text-gray-600"><Settings className="mr-2 h-4 w-4"/>Minting Options</Label>
                    {/* Radio group for selecting minting behavior */}
                    <RadioGroup value={mintOption} onValueChange={(value: string) => setMintOption(value as 'fixed' | 'minter')} className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4" disabled={isLaunching}>
                      {/* Option 1: Fixed Supply */}
                      <div className="flex items-center space-x-2 p-3 border rounded-md flex-1 hover:bg-gray-50 cursor-pointer has-[:checked]:bg-blue-50 has-[:checked]:border-blue-300 transition-colors duration-200">
                        <RadioGroupItem value="fixed" id="fixed" />
                        <Label htmlFor="fixed" className="cursor-pointer w-full">Fixed Supply <span className="block text-xs font-normal text-gray-500">No more tokens can be minted.</span></Label>
                      </div>
                      {/* Option 2: Mintable */}
                      <div className="flex items-center space-x-2 p-3 border rounded-md flex-1 hover:bg-gray-50 cursor-pointer has-[:checked]:bg-blue-50 has-[:checked]:border-blue-300 transition-colors duration-200">
                        <RadioGroupItem value="minter" id="minter" />
                        <Label htmlFor="minter" className="cursor-pointer w-full">Mintable <span className="block text-xs font-normal text-gray-500">You can mint more later.</span></Label>
                      </div>
                    </RadioGroup>
                    {/* Conditional input for Mint Cap if 'Mintable' is selected */}
                    {mintOption === 'minter' && (
                        <div className="pt-2 pl-4 border-l-2 border-blue-200 ml-1 animate-in fade-in duration-300"> {/* Added simple animation */}
                          <Label htmlFor="mintCap">Max Total Supply Cap (Optional)</Label>
                          <Input id="mintCap" type="number" placeholder="Leave blank for no limit" value={mintCap} onChange={(e) => setMintCap(e.target.value)} min={tokenSupply || "1"} disabled={isLaunching} /> {/* Ensure cap >= initial supply */}
                          <p className="text-xs text-gray-500 mt-1">Absolute max tokens (incl. initial supply).</p>
                        </div>
                    )}
                  </div>

                  <Separator />

                  {/* Subsection: Marketing & Logo */}
                  <div className="space-y-4">
                    <Label className="flex items-center text-lg font-medium text-gray-600"><Info className="mr-2 h-4 w-4"/>Marketing Info (Optional)</Label>
                    <div> <Label htmlFor="projectName">Project Name</Label> <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={isLaunching} placeholder="Your Project Name"/> </div>
                    <div> <Label htmlFor="description">Description</Label> <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={isLaunching} rows={3} placeholder="Brief description of your token or project."/> </div>
                    <div>
                      <Label htmlFor="tokenImage">Token Logo</Label>
                      {/* Styled file input */}
                      <Input id="tokenImage" type="file" accept="image/png, image/jpeg, image/gif, image/svg+xml" onChange={handleFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 cursor-pointer" disabled={isLaunching || isUploadingImage}/>
                      {/* Image preview and upload status */}
                      {previewUrl && (
                          <div className="mt-3 flex items-center space-x-3 p-2 border rounded-md bg-white shadow-sm">
                            <img src={previewUrl} alt="Token preview" className="h-12 w-12 rounded-full object-cover border" />
                            <div className="text-sm overflow-hidden">
                              <p className="font-medium truncate" title={selectedFile?.name}>{selectedFile?.name}</p>
                              {/* Status Indicators */}
                              {isUploadingImage && ( <div className="flex items-center text-gray-500 text-xs"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Uploading...</div> )}
                              {!isUploadingImage && ipfsUrl && ( <div className="flex items-center text-green-600 text-xs"><CheckCircle className="mr-1 h-3 w-3" /> Uploaded!</div> )}
                              {!isUploadingImage && selectedFile && !ipfsUrl && ( <div className="flex items-center text-red-600 text-xs"><XCircle className="mr-1 h-3 w-3" /> Upload Failed.</div> )}
                            </div>
                          </div>
                      )}
                      <p className="text-xs text-gray-500 mt-1">Uploads to IPFS via backend. Max 5MB. Square recommended.</p>
                      {/* Removed Pinata config check warning here, rely on function check */}
                      {/* <p className="text-xs text-orange-600 mt-1">Security Note: Uses backend route.</p> */}
                    </div>
                  </div>

                  <Separator />

                  {/* Subsection: Launch Action */}
                  <div className="space-y-3 pt-4">
                    <h3 className="text-lg font-medium text-gray-600 flex items-center"><Check className="mr-2 h-4 w-4"/>Launch</h3>
                    <div className="space-y-3">
                      {/* Display estimated fee */}
                      {estimatedFee && (
                          <p className="text-sm text-gray-600 flex items-center p-3 bg-gray-100 rounded-md border">
                            <CircleDollarSign className="w-4 h-4 mr-2 text-gray-500"/> Estimated Fee: <span className="font-medium ml-1">{estimatedFee}</span>
                          </p>
                      )}
                      {/* Launch Button */}
                      <Button
                          type="submit" // Important: Triggers form onSubmit
                          disabled={isLaunching || !isWalletConnectedToCorrectNetwork || !signingClient || !isCodeIdValid || isUploadingImage}
                          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg py-3 text-base font-semibold transition-opacity duration-300 disabled:opacity-60"
                      >
                        {isLaunching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Launching...</> : 'Launch Token'}
                      </Button>
                    </div>
                  </div>

                </form> {/* End of form */}
              </section> {/* End of Step 2/3 container */}


              {/* --- Section 4: Confirmation --- */}
              {/* Display details of the last launched token if available */}
              {lastLaunchedToken && (
                  <>
                    <Separator />
                    <section className="space-y-3 animate-in fade-in duration-500"> {/* Added animation */}
                      <h2 className="text-xl font-semibold text-green-700 flex items-center border-b pb-2 mb-4">
                        <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white"><Check size={20}/></span>
                        Token Launched Successfully!
                      </h2>
                      {/* Indented confirmation details box */}
                      <div className="ml-11 space-y-2 text-sm border border-green-200 bg-green-50 p-4 rounded-md shadow-sm">
                        <p><strong>Name:</strong> {lastLaunchedToken.name}</p>
                        <p><strong>Symbol:</strong> {lastLaunchedToken.symbol}</p>
                        {/* Contract Address with Copy Button */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-baseline min-w-0"> {/* Ensure wrapping */}
                            <strong className="mr-1">Contract:</strong>
                            <code className="font-mono break-all text-xs flex-1">{lastLaunchedToken.address}</code>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(lastLaunchedToken.address, 'Contract Address')} className="ml-2 p-1 h-auto text-gray-500 hover:text-gray-800 flex-shrink-0">
                            <Copy className="w-3.5 h-3.5"/>
                          </Button>
                        </div>
                        {/* Logo URL if exists */}
                        {lastLaunchedToken.ipfsUrl && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-baseline overflow-hidden min-w-0">
                                <strong className="mr-1">Logo URL:</strong>
                                <a href={lastLaunchedToken.ipfsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs break-all truncate">{lastLaunchedToken.ipfsUrl}</a>
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(lastLaunchedToken.ipfsUrl!, 'Logo URL')} className="ml-2 p-1 h-auto text-gray-500 hover:text-gray-800 flex-shrink-0">
                                <Copy className="w-3.5 h-3.5"/>
                              </Button>
                            </div>
                        )}
                        {/* Transaction Hash with Copy Button */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-baseline overflow-hidden min-w-0">
                            <strong className="mr-1">Tx Hash:</strong>
                            <code className="font-mono break-all text-xs truncate">{lastLaunchedToken.tx}</code>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(lastLaunchedToken.tx, 'Transaction Hash')} className="ml-2 p-1 h-auto text-gray-500 hover:text-gray-800 flex-shrink-0">
                            <Copy className="w-3.5 h-3.5"/>
                          </Button>
                        </div>
                        {/* Link to Explorer */}
                        <a href={`${config?.explorerBaseUrl}${config?.explorerTxPath || '/transaction/'}${lastLaunchedToken.tx}`} target="_blank" rel="noopener noreferrer" className="inline-block bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1 rounded-full mt-2 text-xs font-medium transition-colors duration-200">
                          View Transaction on Explorer &rarr;
                        </a>
                        <p className="text-xs text-gray-600 mt-3 pt-3 border-t border-green-200">Remember to add the token contract address to your wallet (Keplr/Leap) to see your balance.</p>
                      </div>
                    </section>
                  </>
              )}

            </CardContent>
            {/* --- Card Footer --- */}
            <CardFooter className="text-center text-xs text-gray-500 p-4 bg-gray-100 rounded-b-lg border-t">
              {config?.faucetUrl && ( <p>Need testnet funds? Visit the <a href={config.faucetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Sei Faucet</a>.</p> )}
              <p>Ensure your wallet is funded for gas fees. Use audited Code IDs for Mainnet.</p>
            </CardFooter>
          </Card>
        </div>
      </>
  );
}

// --- Required for Sonner ---
// Make sure you have added the <Toaster /> component from 'sonner'
// to your layout.tsx or equivalent root layout file.
// Example layout.tsx:
// import { Toaster } from 'sonner'
// export default function RootLayout({ children }: { children: React.ReactNode }) {
//   return ( <html lang="en"><body>{children}<Toaster richColors /></body></html> )
// }
