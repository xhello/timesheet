'use client';

import * as faceapi from 'face-api.js';

let modelsLoaded = false;
let modelsLoading: Promise<void> | null = null;

// Match threshold - lower = stricter matching (less false positives)
// Increased to 0.55 for easier detection of existing faces
const MATCH_THRESHOLD = 0.55;

// Minimum consecutive matches required before confirming identity
const REQUIRED_CONSECUTIVE_MATCHES = 1;

// Minimum face quality requirements - relaxed for faster detection
const MIN_FACE_AREA = 10000; // pixels squared (was 15000)
const MIN_DETECTION_CONFIDENCE = 0.5; // was 0.7
const MIN_LIVENESS_SCORE = 0.4; // was 0.6

// Check if models are already loaded
export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

// Check if models are currently loading
export function areModelsLoading(): boolean {
  return modelsLoading !== null && !modelsLoaded;
}

export async function loadFaceModels(): Promise<void> {
  // Already loaded
  if (modelsLoaded) return;
  
  // Already loading - wait for existing load
  if (modelsLoading) {
    return modelsLoading;
  }
  
  const MODEL_URL = '/models';
  
  // Start loading and store the promise
  modelsLoading = (async () => {
    try {
      console.log('⏳ Loading face detection models...');
      const startTime = Date.now();
      
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      
      modelsLoaded = true;
      const loadTime = Date.now() - startTime;
      console.log(`✅ Face detection models loaded in ${loadTime}ms`);
    } catch (error) {
      console.error('❌ Failed to load face models:', error);
      modelsLoading = null; // Reset so it can be retried
      throw error;
    }
  })();
  
  return modelsLoading;
}

// Preload models in the background (call this early)
export function preloadFaceModels(): void {
  if (typeof window === 'undefined') return; // Server-side check
  if (modelsLoaded || modelsLoading) return;
  
  // Start loading in background without blocking
  loadFaceModels().catch(err => {
    console.warn('Background model preload failed:', err);
  });
}

export interface FaceDetectionResult {
  detected: boolean;
  descriptor: Float32Array | null;
  livenessScore: number;
  qualityScore: number;
  message: string;
}

export async function detectFace(video: HTMLVideoElement): Promise<FaceDetectionResult> {
  if (!modelsLoaded) {
    await loadFaceModels();
  }

  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,  // Reduced from 416 for faster detection
      scoreThreshold: 0.4  // Reduced from 0.5 for faster face finding
    }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return {
      detected: false,
      descriptor: null,
      livenessScore: 0,
      qualityScore: 0,
      message: 'No face detected. Please position your face in the frame.',
    };
  }

  // Check detection confidence
  if (detection.detection.score < MIN_DETECTION_CONFIDENCE) {
    return {
      detected: true,
      descriptor: null,
      livenessScore: 0,
      qualityScore: detection.detection.score,
      message: 'Face unclear. Please improve lighting and hold still.',
    };
  }

  // Check face size
  const faceArea = detection.detection.box.width * detection.detection.box.height;
  if (faceArea < MIN_FACE_AREA) {
    return {
      detected: true,
      descriptor: null,
      livenessScore: 0,
      qualityScore: 0.3,
      message: 'Please move closer to the camera.',
    };
  }

  // Calculate quality and liveness scores
  const qualityScore = calculateQualityScore(detection);
  const livenessScore = calculateLivenessScore(detection);

  if (qualityScore < 0.5) {
    return {
      detected: true,
      descriptor: null,
      livenessScore,
      qualityScore,
      message: 'Please face the camera directly and hold still.',
    };
  }

  if (livenessScore < MIN_LIVENESS_SCORE) {
    return {
      detected: true,
      descriptor: null,
      livenessScore,
      qualityScore,
      message: 'Please keep your eyes open and look at the camera.',
    };
  }

  return {
    detected: true,
    descriptor: detection.descriptor,
    livenessScore,
    qualityScore,
    message: 'Face verified successfully!',
  };
}

function calculateQualityScore(detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>): number {
  const { detection: faceDetection, landmarks } = detection;
  let score = 1.0;
  
  // 1. Detection confidence
  score *= faceDetection.score;
  
  // 2. Face size score
  const box = faceDetection.box;
  const faceArea = box.width * box.height;
  const idealArea = 40000;
  const sizeScore = Math.min(faceArea / idealArea, 1.0);
  score *= (0.5 + sizeScore * 0.5); // Weight: 50% base + 50% from size
  
  // 3. Face angle/pose estimation using landmarks
  const nose = landmarks.getNose();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  
  // Check horizontal alignment (face not turned too much)
  const leftEyeCenter = getCenterPoint(leftEye);
  const rightEyeCenter = getCenterPoint(rightEye);
  const eyeAngle = Math.abs(Math.atan2(
    rightEyeCenter.y - leftEyeCenter.y,
    rightEyeCenter.x - leftEyeCenter.x
  ));
  
  // Penalize tilted faces (angle should be close to 0)
  if (eyeAngle > 0.2) { // ~11 degrees
    score *= 0.7;
  }
  
  // 4. Check if face is centered using nose position relative to eyes
  const noseTop = nose[0];
  const eyeMidpoint = {
    x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
    y: (leftEyeCenter.y + rightEyeCenter.y) / 2
  };
  
  // Nose should be roughly below eye midpoint (not turned sideways)
  const horizontalOffset = Math.abs(noseTop.x - eyeMidpoint.x);
  const eyeDistance = distanceSimple(leftEyeCenter, rightEyeCenter);
  
  if (horizontalOffset > eyeDistance * 0.3) {
    score *= 0.6; // Face is turned too much
  }
  
  return Math.min(score, 1.0);
}

function calculateLivenessScore(detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>): number {
  const { detection: faceDetection, landmarks } = detection;
  
  // Base score from detection confidence
  let score = faceDetection.score;
  
  // Check face size (should be reasonably large)
  const box = faceDetection.box;
  const faceArea = box.width * box.height;
  
  if (faceArea < MIN_FACE_AREA) {
    score *= 0.5;
  }
  
  // Check if eyes are open by analyzing eye landmarks
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  
  const leftEyeOpenness = getEyeOpenness(leftEye);
  const rightEyeOpenness = getEyeOpenness(rightEye);
  
  // Both eyes should be open
  if (leftEyeOpenness < 0.2 || rightEyeOpenness < 0.2) {
    score *= 0.5; // Eyes likely closed
  } else if (leftEyeOpenness < 0.25 || rightEyeOpenness < 0.25) {
    score *= 0.7; // Eyes partially closed
  }
  
  // Check eye symmetry (both eyes should have similar openness)
  const eyeSymmetry = Math.min(leftEyeOpenness, rightEyeOpenness) / 
                      Math.max(leftEyeOpenness, rightEyeOpenness);
  if (eyeSymmetry < 0.5) {
    score *= 0.8; // Asymmetric eyes (might be winking or photo)
  }
  
  // Check mouth is not wide open (unusual for normal pose)
  const mouth = landmarks.getMouth();
  const mouthOpenness = getMouthOpenness(mouth);
  if (mouthOpenness > 0.5) {
    score *= 0.8;
  }
  
  return Math.min(score, 1.0);
}

interface SimplePoint {
  x: number;
  y: number;
}

function getCenterPoint(points: faceapi.Point[]): SimplePoint {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function distanceSimple(p1: SimplePoint, p2: SimplePoint): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

function getMouthOpenness(mouthPoints: faceapi.Point[]): number {
  // Mouth landmarks: outer (0-11), inner (12-19)
  // Calculate vertical opening relative to width
  const topLip = mouthPoints[14]; // Top inner lip
  const bottomLip = mouthPoints[18]; // Bottom inner lip
  const leftCorner = mouthPoints[0];
  const rightCorner = mouthPoints[6];
  
  const mouthHeight = distance(topLip, bottomLip);
  const mouthWidth = distance(leftCorner, rightCorner);
  
  return mouthHeight / mouthWidth;
}

function getEyeOpenness(eyePoints: faceapi.Point[]): number {
  // Calculate eye aspect ratio
  const vertical1 = distance(eyePoints[1], eyePoints[5]);
  const vertical2 = distance(eyePoints[2], eyePoints[4]);
  const horizontal = distance(eyePoints[0], eyePoints[3]);
  
  return (vertical1 + vertical2) / (2 * horizontal);
}

function distance(p1: faceapi.Point, p2: faceapi.Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function compareFaceDescriptors(
  descriptor1: Float32Array,
  descriptor2: Float32Array
): number {
  return faceapi.euclideanDistance(descriptor1, descriptor2);
}

export interface MatchResult {
  employeeId: string;
  distance: number;
  confidence: number;
}

export function findMatchingEmployee(
  capturedDescriptor: Float32Array,
  employees: Array<{ id: string; face_encoding: Record<string, number> | null }>
): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  let secondBestDistance = Infinity;
  
  for (const employee of employees) {
    if (!employee.face_encoding) continue;
    
    // Convert stored encoding back to Float32Array
    const storedDescriptor = new Float32Array(
      Object.keys(employee.face_encoding)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(key => employee.face_encoding![key])
    );
    
    const dist = compareFaceDescriptors(capturedDescriptor, storedDescriptor);
    
    if (dist < MATCH_THRESHOLD) {
      if (!bestMatch || dist < bestMatch.distance) {
        if (bestMatch) {
          secondBestDistance = bestMatch.distance;
        }
        // Calculate confidence based on how far below threshold
        const confidence = Math.max(0, (MATCH_THRESHOLD - dist) / MATCH_THRESHOLD);
        bestMatch = { employeeId: employee.id, distance: dist, confidence };
      } else if (dist < secondBestDistance) {
        secondBestDistance = dist;
      }
    }
  }
  
  // Ensure best match is significantly better than second best (ambiguity check)
  if (bestMatch && secondBestDistance < Infinity) {
    const margin = secondBestDistance - bestMatch.distance;
    if (margin < 0.1) {
      // Too close to another face - ambiguous match
      console.log('⚠️ Ambiguous match detected, margin:', margin);
      bestMatch.confidence *= 0.5;
    }
  }
  
  return bestMatch;
}

// Consecutive match tracker for improved accuracy
export class ConsecutiveMatchTracker {
  private matches: string[] = [];
  private readonly requiredMatches: number;
  
  constructor(requiredMatches: number = REQUIRED_CONSECUTIVE_MATCHES) {
    this.requiredMatches = requiredMatches;
  }
  
  addMatch(employeeId: string | null): { confirmed: boolean; employeeId: string | null; streak: number } {
    if (!employeeId) {
      // Reset on no match
      this.matches = [];
      return { confirmed: false, employeeId: null, streak: 0 };
    }
    
    // Check if same person as last match
    if (this.matches.length > 0 && this.matches[this.matches.length - 1] !== employeeId) {
      // Different person - reset
      this.matches = [employeeId];
      return { confirmed: false, employeeId, streak: 1 };
    }
    
    this.matches.push(employeeId);
    
    // Trim to only keep recent matches
    if (this.matches.length > this.requiredMatches + 2) {
      this.matches = this.matches.slice(-this.requiredMatches - 2);
    }
    
    const confirmed = this.matches.length >= this.requiredMatches;
    return { 
      confirmed, 
      employeeId, 
      streak: this.matches.length 
    };
  }
  
  reset(): void {
    this.matches = [];
  }
  
  getStreak(): number {
    return this.matches.length;
  }
}

// Export constants for use in components
export { MATCH_THRESHOLD, REQUIRED_CONSECUTIVE_MATCHES, MIN_LIVENESS_SCORE };

export function descriptorToObject(descriptor: Float32Array): Record<string, number> {
  const obj: Record<string, number> = {};
  descriptor.forEach((value, index) => {
    obj[index.toString()] = value;
  });
  return obj;
}

// Auto-preload models when this module is imported on the client
// This starts loading immediately when any page imports faceDetection
if (typeof window !== 'undefined') {
  // Use requestIdleCallback for non-blocking preload, fallback to setTimeout
  const schedulePreload = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1));
  schedulePreload(() => {
    preloadFaceModels();
  });
}
