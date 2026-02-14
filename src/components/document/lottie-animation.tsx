import Lottie from 'lottie-react';
import loadingAnimation from './loading.json';

export default function LottieAnimation() {
  return (
    <div className="h-72 w-72">
      <Lottie animationData={loadingAnimation} loop={true} />
    </div>
  );
}
