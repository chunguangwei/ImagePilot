#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // 必须与 package.json 的 "name" 字段一致（index.js 用它注册），全小写
  self.moduleName = @"imagepilot";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end

// RN 0.72 creates its bridge/root window in AppDelegate. Attach that existing
// window to the single UIKit scene (required when building with the iOS 27 SDK).
@interface ImagePilotSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

@implementation ImagePilotSceneDelegate
- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
    options:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:[UIWindowScene class]]) return;
  AppDelegate *appDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
  self.window = appDelegate.window;
  self.window.windowScene = (UIWindowScene *)scene;
  [self.window makeKeyAndVisible];
}
@end
